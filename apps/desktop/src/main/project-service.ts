import { randomUUID } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  createProject,
  generateStructuredFiles,
  mergeGeneratedDocument,
  mergeGeneratedJava,
  sameJavaTokens,
} from '@frc-framework/code-generator';
import {
  createEmptyProject,
  DomainSession,
  executeCommand,
  subsystemJavaLocation,
  validateModel,
  type DomainCommand,
  type FrcProjectModel,
} from '@frc-framework/domain';
import { JavaProjectIndexer, type SourceImportReport } from '@frc-framework/java-parser';
import { PRESET_MANIFESTS } from '@frc-framework/presets';
import { addJavaImport } from '@frc-framework/java-parser';
import {
  acquireProjectLock,
  applyFileTransaction,
  calculateFileDiff,
  createCandidateOutput,
  classifyProjectFile,
  isSafeAutoApply,
  isIgnoredProjectPath,
  inspectProjectYamlMigration,
  loadProjectYaml,
  migrateProjectYaml,
  ProjectWatcher,
  recoverIncompleteTransactions,
  stringifyProjectYaml,
  type FileChange,
  type ProjectFileContent,
  type ProjectLockResult,
  type ProjectFileEvent,
} from '@frc-framework/project-io';

import type {
  CreateProjectRequest,
  AddImportRequest,
  DirectoryKind,
  DirectorySelection,
  ProjectOpenResult,
  ProjectChangePreview,
  ProjectSourceFile,
  DocSupplementRequest,
  RecentProject,
  ExternalConflictRequest,
  ExternalConflictResult,
  ProjectFileEventView,
} from '../shared/ipc.js';
import { PathGrantRegistry } from './security/path-grants.js';
import type { SettingsStore } from './settings-store.js';

export class ProjectService {
  readonly #grants = new PathGrantRegistry();
  readonly #settings: SettingsStore;
  readonly #templateRoot: string;
  readonly #validateCreatedProject: boolean;
  readonly #javaWasmPath: string | undefined;
  readonly #runtimeWasmPath: string | undefined;
  #lock: ProjectLockResult | undefined;
  #root: string | undefined;
  #session: DomainSession | undefined;
  #pending: PendingChange | undefined;
  #sourceImportPending = false;
  #indexer: JavaProjectIndexer | undefined;
  #watcher: ProjectWatcher | undefined;
  readonly #externalFiles = new Set<string>();
  readonly #fileListeners = new Set<(events: readonly ProjectFileEventView[]) => void>();

  constructor(
    settings: SettingsStore,
    templateRoot: string,
    options: {
      readonly javaWasmPath?: string;
      readonly runtimeWasmPath?: string;
      readonly validateCreatedProject?: boolean;
    } = {},
  ) {
    this.#settings = settings;
    this.#templateRoot = templateRoot;
    this.#validateCreatedProject = options.validateCreatedProject !== false;
    this.#javaWasmPath = options.javaWasmPath;
    this.#runtimeWasmPath = options.runtimeWasmPath;
  }

  toolchainContext(): {
    readonly projectRoot: string;
    readonly wpilibYear: number;
    readonly teamNumber: number;
    readonly pendingStructuredChanges: boolean;
    readonly externallyModifiedFiles: number;
  } {
    if (this.#root === undefined || this.#session === undefined)
      throw new Error('No project is open.');
    return {
      externallyModifiedFiles: this.#externalFiles.size,
      pendingStructuredChanges: this.#pending !== undefined,
      projectRoot: this.#root,
      teamNumber: this.#session.model.project.teamNumber,
      wpilibYear: this.#session.model.project.wpilibYear,
    };
  }

  onFilesChanged(listener: (events: readonly ProjectFileEventView[]) => void): () => void {
    this.#fileListeners.add(listener);
    return () => this.#fileListeners.delete(listener);
  }

  async inspectDirectory(directoryPath: string): Promise<DirectorySelection> {
    const canonicalPath = await this.#grants.grant(directoryPath);
    const entries = await readdir(canonicalPath);
    const kind = await detectDirectoryKind(canonicalPath, entries);
    return {
      canceled: false,
      displayName: path.basename(canonicalPath),
      entryCount: entries.length,
      kind,
      path: canonicalPath,
    };
  }

  async create(request: CreateProjectRequest): Promise<ProjectOpenResult> {
    const root = await this.#grants.assertGranted(request.path);
    const entries = await readdir(root);
    if (entries.length > 0) {
      throw new Error('Project creation requires the selected directory to be empty.');
    }
    const model = createEmptyProject({
      javaPackage: request.javaPackage,
      name: request.name,
      teamNumber: request.teamNumber,
      wpilibYear: request.wpilibYear,
    });
    await createProject({
      model,
      projectRoot: root,
      templateRoot: this.#templateRoot,
      validateBuild: this.#validateCreatedProject,
    });
    return this.open(root);
  }

  async open(projectPath: string, preserveExternal = false): Promise<ProjectOpenResult> {
    const root = await this.#grants.grant(projectPath);
    const sameProject = this.#root === root;
    await this.#watcher?.close();
    this.#watcher = undefined;
    if (!preserveExternal || !sameProject) this.#externalFiles.clear();
    await recoverIncompleteTransactions(root);
    await this.#lock?.release();
    this.#lock = await acquireProjectLock(root);
    const readOnly = this.#lock.mode !== 'read-write';
    const yamlPath = path.join(root, 'project.yaml');
    let result: ProjectOpenResult;
    try {
      const migration = await inspectProjectYamlMigration(yamlPath);
      if (migration.required) {
        this.#root = root;
        this.#session = undefined;
        this.#pending = undefined;
        this.#sourceImportPending = false;
        result = {
          displayName: path.basename(root),
          migration: {
            fromVersion: migration.fromVersion,
            summary: migration.summary,
            supported: migration.supported,
            toVersion: migration.toVersion,
          },
          mode: 'yaml',
          path: root,
          problems: migration.supported
            ? ['This project requires a reviewed schema migration before editing.']
            : migration.summary,
          readOnly,
          sourceFiles: await this.#sourceFiles(root),
        };
        await this.#settings.putRecent({
          available: true,
          displayName: result.displayName,
          lastOpenedAt: new Date().toISOString(),
          path: root,
        });
        await this.#startWatcher(root);
        return result;
      }
      const parsed = await loadProjectYaml(yamlPath);
      const sourceReport = parsed.model === undefined ? undefined : await this.#sourceReport(root);
      const structuredModel =
        parsed.model === undefined || sourceReport === undefined
          ? parsed.model
          : reconcileLegacySourceImport(parsed.model, sourceReport.model);
      const visibleModel =
        structuredModel === undefined || sourceReport === undefined
          ? structuredModel
          : mergeSourceOverlay(structuredModel, sourceReport.model);
      result = {
        displayName: visibleModel?.project.displayName ?? path.basename(root),
        mode: 'yaml',
        ...(visibleModel === undefined ? {} : { model: visibleModel }),
        path: root,
        problems: [
          ...parsed.problems.map((problem) => problem.message),
          ...(structuredModel === undefined
            ? []
            : [
                ...validateModel(structuredModel).map((problem) => problem.message),
                ...validatePresetCompatibility(structuredModel),
                ...(await validateAutoResources(root, structuredModel)),
              ]),
        ],
        readOnly,
        sourceFiles: await sourceFiles(root, sourceReport, this.#externalFiles),
      };
      this.#session =
        structuredModel === undefined ? undefined : new DomainSession(structuredModel);
      this.#sourceImportPending = false;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }
      const javaFiles = await countJavaFiles(root);
      let report: SourceImportReport | undefined;
      if (javaFiles > 0)
        report = await this.#javaIndexer().then((indexer) => indexer.indexProject(root));
      const browseOnly = report === undefined;
      const visibleModel = report?.model ?? (await createBrowseOnlyModel(root));
      result = {
        displayName: path.basename(root),
        mode: 'source',
        model: visibleModel,
        ...(browseOnly ? { sourceBrowseOnly: true } : {}),
        ...(report === undefined
          ? {}
          : {
              needsImportConfirmation: true,
              sourceImport: {
                customFiles: report.customFiles.length,
                partialFiles: report.partialFiles.length,
                recognizedFiles: report.recognizedFiles.length,
                vendordeps: report.vendordeps,
              },
            }),
        path: root,
        problems: browseOnly
          ? [
              'No project.yaml or Java source files were found; structured Java editing is disabled.',
            ]
          : [
              `project.yaml is missing; source fallback found ${String(javaFiles)} Java files.`,
              ...(report?.problems ?? []),
            ],
        readOnly,
        sourceFiles: await sourceFiles(root, report, this.#externalFiles),
      };
      this.#session = report === undefined ? undefined : new DomainSession(report.model);
      this.#sourceImportPending = report !== undefined;
    }
    this.#root = root;
    this.#pending = undefined;
    await this.#settings.putRecent({
      available: true,
      displayName: result.displayName,
      lastOpenedAt: new Date().toISOString(),
      path: root,
    });
    await this.#startWatcher(root);
    return result;
  }

  async migrate(): Promise<ProjectOpenResult> {
    const root = this.#root;
    if (root === undefined) throw new Error('No project is open.');
    if (this.#lock?.mode !== 'read-write') throw new Error('The current project is read-only.');
    const yamlPath = await this.#grants.assertGranted(path.join(root, 'project.yaml'));
    const preview = await inspectProjectYamlMigration(yamlPath);
    if (!preview.required) return this.open(root);
    if (!preview.supported) throw new Error('This project schema cannot be downgraded safely.');
    await migrateProjectYaml(yamlPath);
    return this.open(root);
  }

  async refresh(): Promise<ProjectOpenResult> {
    const root = this.#root;
    if (root === undefined) throw new Error('No project is open.');
    return this.open(root, true);
  }

  async resolveExternal(request: ExternalConflictRequest): Promise<ExternalConflictResult> {
    const root = this.#root;
    const session = this.#session;
    if (root === undefined || session === undefined)
      throw new Error('No structured project is open.');
    const paths = [...new Set(request.paths.map(normalizeRelativePath))];
    if (paths.length === 0) throw new Error('No changed files were selected.');
    for (const relativePath of paths) {
      const absolute = path.resolve(root, relativePath);
      if (!isWithin(root, absolute))
        throw new Error('External change path is outside the project.');
    }
    if (request.action === 'reload') {
      this.#pending = undefined;
      paths.forEach((filePath) => this.#externalFiles.delete(filePath));
      return { project: await this.open(root, true) };
    }
    if (this.#lock?.mode !== 'read-write') throw new Error('The current project is read-only.');

    if (request.action === 'keep-code') {
      this.#pending = undefined;
      const unmanagedFiles = [
        ...new Set([
          ...session.model.unmanagedFiles,
          ...paths.filter((filePath) => filePath.endsWith('.java')),
        ]),
      ].sort();
      const model = { ...session.model, unmanagedFiles };
      const files = new Map<string, ProjectFileContent | null>([
        ['project.yaml', stringifyProjectYaml(model)],
      ]);
      const preview = await this.#setPendingPreview(model, files);
      return { preview };
    }

    const baseModel =
      request.action === 'compare' ? (this.#pending?.model ?? session.model) : session.model;
    this.#pending = undefined;
    const model =
      request.action === 'regenerate'
        ? {
            ...baseModel,
            unmanagedFiles: baseModel.unmanagedFiles.filter(
              (filePath) => !paths.includes(filePath),
            ),
          }
        : baseModel;
    let files: ReadonlyMap<string, ProjectFileContent | null>;
    let problems: readonly string[] = [];
    try {
      files = await this.#candidateFiles(
        root,
        model,
        request.action === 'regenerate' ? new Set(paths) : undefined,
        request.action === 'compare' ? new Set(paths) : undefined,
      );
    } catch (error) {
      if (request.action !== 'compare') throw error;
      files = await this.#candidateFiles(root, model, new Set(paths));
      problems = [
        'Managed region markers changed. This comparison is read-only; choose Keep code or Regenerate explicitly.',
      ];
    }
    const preview = await this.#setPendingPreview(model, files, problems);
    return { preview };
  }

  async previewCommand(command: DomainCommand): Promise<ProjectChangePreview> {
    const root = this.#root;
    const session = this.#session;
    if (root === undefined || session === undefined) {
      throw new Error('Open a project with project.yaml before making structured changes.');
    }
    if (this.#lock?.mode !== 'read-write') {
      throw new Error('The current project is read-only.');
    }
    if (this.#pending !== undefined) {
      throw new Error('Apply or discard the current preview before making another change.');
    }
    if (this.#sourceImportPending) {
      throw new Error('Confirm the source import before making structured changes.');
    }
    const result = executeCommand(session.model, command);
    const problems = validateModel(result.model)
      .filter((problem) => problem.severity === 'error')
      .map((problem) => `${problem.path}: ${problem.message}`);
    problems.push(...(await validateAutoResources(root, result.model)));
    problems.push(...validatePresetCompatibility(result.model));
    const files =
      problems.length === 0 ? await this.#candidateFiles(root, result.model) : new Map();
    const candidate = await createCandidateOutput(root, textCandidate(files));
    const changes = problems.length === 0 ? await calculateFileDiff(root, candidate) : [];
    const id = randomUUID();
    this.#pending = { changes, command, files, id, model: result.model, problems };
    return {
      changes,
      id,
      model: result.model,
      problems,
      safeToApply: problems.length === 0 && isSafeAutoApply(changes),
    };
  }

  async confirmSourceImport(): Promise<ProjectChangePreview> {
    const root = this.#root;
    const session = this.#session;
    if (root === undefined || session === undefined || !this.#sourceImportPending) {
      throw new Error('There is no source import awaiting confirmation.');
    }
    if (this.#lock?.mode !== 'read-write') throw new Error('The current project is read-only.');
    if (this.#pending !== undefined) throw new Error('Another preview is already active.');
    const files = new Map<string, ProjectFileContent | null>();
    files.set('project.yaml', stringifyProjectYaml(session.model));
    for (const [filePath, content] of generateStructuredFiles(session.model)) {
      if (!filePath.endsWith('.md') || typeof content !== 'string') continue;
      files.set(
        filePath,
        mergeGeneratedDocument(await readOptional(path.join(root, filePath)), content),
      );
    }
    const candidate = await createCandidateOutput(root, textCandidate(files));
    const changes = await calculateFileDiff(root, candidate);
    const id = randomUUID();
    this.#pending = { changes, files, id, model: session.model, problems: [], sourceImport: true };
    return {
      changes,
      id,
      model: session.model,
      problems: [],
      safeToApply: isSafeAutoApply(changes),
    };
  }

  async addImport(request: AddImportRequest): Promise<ProjectChangePreview> {
    const root = this.#root;
    const session = this.#session;
    if (root === undefined || session === undefined)
      throw new Error('No structured project is open.');
    if (this.#sourceImportPending)
      throw new Error('Confirm the source import before editing Java.');
    if (this.#lock?.mode !== 'read-write') throw new Error('The current project is read-only.');
    if (this.#pending !== undefined) throw new Error('Another preview is already active.');
    const requested = path.isAbsolute(request.file) ? request.file : path.join(root, request.file);
    const filePath = await this.#grants.assertGranted(requested);
    if (!filePath.endsWith('.java')) throw new Error('Imports can only be added to Java files.');
    const relativePath = path.relative(root, filePath).replace(/\\/gu, '/');
    const edit = addJavaImport(await readFile(filePath, 'utf8'), request.importName, {
      isStatic: request.isStatic,
    });
    const files = new Map<string, ProjectFileContent | null>([[relativePath, edit.source]]);
    const candidate = await createCandidateOutput(root, textCandidate(files));
    const changes = await calculateFileDiff(root, candidate);
    const id = randomUUID();
    this.#pending = { changes, files, id, model: session.model, problems: [] };
    return {
      changes,
      id,
      model: session.model,
      problems: [],
      safeToApply: isSafeAutoApply(changes),
    };
  }

  async readDocSupplement(relativePath: string): Promise<string> {
    const filePath = await this.#documentationPath(relativePath);
    const content = await readFile(filePath, 'utf8');
    const match = content.match(
      /<!-- frc-framework:user-supplement:start -->\s*([\s\S]*?)\s*<!-- frc-framework:user-supplement:end -->/u,
    );
    if (match === null) throw new Error('This document has no editable user supplement region.');
    return match[1]?.trim() ?? '';
  }

  async previewDocSupplement(request: DocSupplementRequest): Promise<ProjectChangePreview> {
    const root = this.#root;
    const session = this.#session;
    if (root === undefined || session === undefined)
      throw new Error('No structured project is open.');
    if (this.#lock?.mode !== 'read-write') throw new Error('The current project is read-only.');
    if (this.#pending !== undefined) throw new Error('Another preview is already active.');
    if (request.markdown.includes('frc-framework:user-supplement')) {
      throw new Error('User notes cannot contain FRC Framework region markers.');
    }
    const filePath = await this.#documentationPath(request.path);
    const existing = await readFile(filePath, 'utf8');
    const marker =
      /(<!-- frc-framework:user-supplement:start -->)\s*[\s\S]*?\s*(<!-- frc-framework:user-supplement:end -->)/u;
    if (!marker.test(existing))
      throw new Error('This document has no editable user supplement region.');
    const content = existing.replace(marker, `$1\n${request.markdown.trim()}\n$2`);
    const relative = path.relative(root, filePath).replace(/\\/gu, '/');
    const files = new Map<string, ProjectFileContent | null>([[relative, content]]);
    const candidate = await createCandidateOutput(root, textCandidate(files));
    const changes = await calculateFileDiff(root, candidate);
    const id = randomUUID();
    this.#pending = { changes, files, id, model: session.model, problems: [] };
    return {
      changes,
      id,
      model: session.model,
      problems: [],
      safeToApply: isSafeAutoApply(changes),
    };
  }

  async applyPreview(previewId: string): Promise<ProjectOpenResult> {
    const pending = this.#assertPending(previewId);
    const root = this.#root;
    const session = this.#session;
    if (root === undefined || session === undefined) throw new Error('No project is open.');
    if (pending.problems.length > 0) throw new Error('The preview contains blocking problems.');
    const changed = new Map(
      [...pending.files].filter(([filePath]) =>
        pending.changes.some((change) => change.path === filePath && change.kind !== 'unchanged'),
      ),
    );
    for (const [filePath, content] of changed) {
      if (content === null || typeof content === 'string') {
        this.#watcher?.recordSelfWrite(filePath, content);
      }
    }
    await applyFileTransaction(root, changed);
    if (pending.command === undefined) {
      session.replaceFromDisk(pending.model);
      this.#sourceImportPending = false;
    } else {
      const applied = session.execute(pending.command);
      if (JSON.stringify(applied.model) !== JSON.stringify(pending.model)) {
        throw new Error('Applied model diverged from its preview.');
      }
    }
    session.markClean();
    this.#pending = undefined;
    return this.#resultFromSession(root, []);
  }

  async discardPreview(previewId: string): Promise<void> {
    this.#assertPending(previewId);
    this.#pending = undefined;
  }

  async #candidateFiles(
    root: string,
    model: FrcProjectModel,
    forceGeneratedPaths: ReadonlySet<string> = new Set(),
    includeUnchangedPaths: ReadonlySet<string> = new Set(),
  ): Promise<ReadonlyMap<string, ProjectFileContent | null>> {
    const generated = new Map<string, ProjectFileContent | null>();
    const previousModel = this.#session?.model;
    const previousGenerated =
      previousModel === undefined ? new Map() : generateStructuredFiles(previousModel);
    const nextGenerated = generateStructuredFiles(model);
    const relocations =
      previousModel === undefined
        ? new Map<string, GeneratedJavaRelocation>()
        : generatedJavaRelocations(previousModel, model, previousGenerated, nextGenerated);
    generated.set('project.yaml', stringifyProjectYaml(model));
    for (const [filePath, content] of nextGenerated) {
      if (model.unmanagedFiles.includes(filePath)) continue;
      if (typeof content !== 'string') {
        generated.set(filePath, content);
        continue;
      }
      const existing = await readOptional(path.join(root, filePath));
      const previous = previousGenerated.get(filePath);
      const relocation = relocations.get(filePath);
      const forced = forceGeneratedPaths.has(filePath);
      // Do not touch a generated path when this command did not change its
      // expected output. This isolates structured edits from stale
      // files produced by an older FRC Framework version and from unrelated
      // team-owned edits. Missing legacy files are repaired only through the
      // explicit Regenerate action instead of being mixed into another edit.
      if (!forced && !includeUnchangedPaths.has(filePath) && previous === content) continue;
      try {
        let candidate: ProjectFileContent = content;
        if (!forced) {
          if (filePath.endsWith('.java') && relocation !== undefined && existing === undefined) {
            const relocatedExisting = await readOptional(path.join(root, relocation.previousPath));
            const relocatedGenerated = previousGenerated.get(relocation.previousPath);
            candidate = relocatedJava(relocatedExisting, relocatedGenerated, content, relocation);
          } else if (
            typeof previous === 'string' &&
            (existing === previous ||
              (filePath.endsWith('.java') && sameGeneratedJava(existing, previous)))
          ) {
            candidate = content;
          } else if (filePath.endsWith('.java')) {
            candidate = mergeGeneratedJava(
              existing,
              content,
              typeof previous === 'string' ? previous : undefined,
            );
          } else if (filePath.endsWith('.md')) {
            candidate = mergeGeneratedDocument(existing, content);
          }
        }
        generated.set(filePath, candidate);
      } catch (error) {
        if (
          typeof existing === 'string' &&
          previousModel !== undefined &&
          isLegacyNestedRemovalNoop(filePath, existing, previousModel, model)
        ) {
          generated.set(filePath, existing);
          continue;
        }
        throw new Error(`${filePath}: ${error instanceof Error ? error.message : String(error)}`, {
          cause: error,
        });
      }
    }
    if (previousModel !== undefined) {
      for (const filePath of previousGenerated.keys()) {
        if (
          !nextGenerated.has(filePath) &&
          !model.unmanagedFiles.includes(filePath) &&
          !previousModel.unmanagedFiles.includes(filePath)
        ) {
          generated.set(filePath, null);
        }
      }
    }
    return generated;
  }

  async #setPendingPreview(
    model: FrcProjectModel,
    files: ReadonlyMap<string, ProjectFileContent | null>,
    problems: readonly string[] = [],
  ): Promise<ProjectChangePreview> {
    const root = this.#root;
    if (root === undefined) throw new Error('No project is open.');
    const candidate = await createCandidateOutput(root, textCandidate(files));
    const changes = await calculateFileDiff(root, candidate);
    const id = randomUUID();
    this.#pending = { changes, files, id, model, problems };
    return {
      changes,
      id,
      model,
      problems,
      safeToApply: problems.length === 0 && isSafeAutoApply(changes),
    };
  }

  async #startWatcher(root: string): Promise<void> {
    const watcher = new ProjectWatcher(root, {
      hasPendingChanges: (relativePath) =>
        this.#pending?.changes.some(
          (change) => change.kind !== 'unchanged' && change.path === relativePath,
        ) ?? false,
      onEvents: (events) => this.#handleFileEvents(events),
    });
    await watcher.start();
    this.#watcher = watcher;
  }

  #handleFileEvents(events: readonly ProjectFileEvent[]): void {
    for (const event of events) {
      if (event.external) this.#externalFiles.add(event.path);
      else this.#externalFiles.delete(event.path);
    }
    const views = events.map((event) => ({ ...event }));
    for (const listener of this.#fileListeners) listener(views);
  }

  #assertPending(previewId: string): PendingChange {
    if (this.#pending === undefined || this.#pending.id !== previewId) {
      throw new Error('The change preview is missing or stale.');
    }
    return this.#pending;
  }

  async #resultFromSession(root: string, problems: readonly string[]): Promise<ProjectOpenResult> {
    const model = this.#session?.model;
    if (model === undefined) throw new Error('No structured project is open.');
    const report = await this.#sourceReport(root);
    const visibleModel = report === undefined ? model : mergeSourceOverlay(model, report.model);
    return {
      displayName: visibleModel.project.displayName,
      mode: 'yaml',
      model: visibleModel,
      path: root,
      problems,
      readOnly: this.#lock?.mode !== 'read-write',
      sourceFiles: await sourceFiles(root, report, this.#externalFiles),
    };
  }

  async recent(): Promise<readonly RecentProject[]> {
    const result: RecentProject[] = [];
    for (const project of this.#settings.state.recentProjects) {
      result.push({ ...project, available: await directoryExists(project.path) });
    }
    return result;
  }

  async removeRecent(projectPath: string): Promise<readonly RecentProject[]> {
    await this.#settings.removeRecent(projectPath);
    return this.recent();
  }

  async relinkRecent(oldPath: string, newPath: string): Promise<readonly RecentProject[]> {
    const inspected = await this.inspectDirectory(newPath);
    if (inspected.kind !== 'frc-project' || inspected.path === undefined) {
      throw new Error('The replacement directory is not an FRC project.');
    }
    await this.#settings.replaceRecentPath(oldPath, {
      available: true,
      displayName: inspected.displayName ?? path.basename(inspected.path),
      lastOpenedAt: new Date().toISOString(),
      path: inspected.path,
    });
    return this.recent();
  }

  async close(): Promise<void> {
    await this.#watcher?.close();
    this.#watcher = undefined;
    await this.#lock?.release();
    this.#indexer?.dispose();
    this.#indexer = undefined;
    this.#grants.revokeAll();
  }

  async #javaIndexer(): Promise<JavaProjectIndexer> {
    this.#indexer ??= await JavaProjectIndexer.create({
      ...(this.#javaWasmPath === undefined ? {} : { javaWasmPath: this.#javaWasmPath }),
      ...(this.#runtimeWasmPath === undefined ? {} : { runtimeWasmPath: this.#runtimeWasmPath }),
    });
    return this.#indexer;
  }

  async #sourceFiles(root: string): Promise<readonly ProjectSourceFile[]> {
    const report = await this.#sourceReport(root);
    return sourceFiles(root, report, this.#externalFiles);
  }

  async #sourceReport(root: string): Promise<SourceImportReport | undefined> {
    if ((await countJavaFiles(root)) === 0) return undefined;
    return withTimeout(
      this.#javaIndexer().then((indexer) => indexer.indexProject(root)),
      10_000,
      'Java source indexing timed out.',
    );
  }

  async #documentationPath(relativePath: string): Promise<string> {
    const root = this.#root;
    if (root === undefined) throw new Error('No project is open.');
    const normalized = relativePath.replace(/\\/gu, '/');
    if (
      !/^docs\/[A-Za-z0-9_.\-/]+\.md$/u.test(normalized) ||
      normalized.split('/').includes('..')
    ) {
      throw new Error('Documentation edits are limited to Markdown files under docs/.');
    }
    return this.#grants.assertGranted(path.join(root, normalized));
  }
}

function sameGeneratedJava(existing: ProjectFileContent | undefined, generated: string): boolean {
  return typeof existing === 'string' && sameJavaTokens(existing, generated);
}

interface GeneratedJavaRelocation {
  readonly classNameChanged: boolean;
  readonly previousPath: string;
}

function generatedJavaRelocations(
  previous: FrcProjectModel,
  next: FrcProjectModel,
  previousGenerated: ReadonlyMap<string, ProjectFileContent>,
  nextGenerated: ReadonlyMap<string, ProjectFileContent>,
): ReadonlyMap<string, GeneratedJavaRelocation> {
  const relocations = new Map<string, GeneratedJavaRelocation>();
  for (const oldSubsystem of previous.subsystems) {
    const newSubsystem = next.subsystems.find((entry) => entry.id === oldSubsystem.id);
    if (newSubsystem === undefined) continue;
    const oldRuntime = subsystemJavaLocation(previous, oldSubsystem).file;
    const newRuntime = subsystemJavaLocation(next, newSubsystem).file;
    addRelocation(oldRuntime, newRuntime, oldSubsystem.symbol !== newSubsystem.symbol);
    addRelocation(
      oldRuntime.replace(/\.java$/u, 'Config.java'),
      newRuntime.replace(/\.java$/u, 'Config.java'),
      oldSubsystem.symbol !== newSubsystem.symbol,
    );
  }
  return relocations;

  function addRelocation(previousPath: string, nextPath: string, classNameChanged: boolean): void {
    if (
      previousPath === nextPath ||
      typeof previousGenerated.get(previousPath) !== 'string' ||
      typeof nextGenerated.get(nextPath) !== 'string'
    )
      return;
    relocations.set(nextPath, { classNameChanged, previousPath });
  }
}

function relocatedJava(
  existing: ProjectFileContent | undefined,
  previousGenerated: ProjectFileContent | undefined,
  generated: string,
  relocation: GeneratedJavaRelocation,
): string {
  if (typeof existing !== 'string' || typeof previousGenerated !== 'string') return generated;
  if (sameJavaTokens(existing, previousGenerated)) return generated;
  if (relocation.classNameChanged) {
    throw new Error(
      `${relocation.previousPath}: Java symbol changed while team-owned code is present; rename the class in the IDE or restore the generated file before retrying.`,
    );
  }
  const merged = mergeGeneratedJava(existing, generated, previousGenerated);
  const generatedPackage = /^package\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*;/mu.exec(
    generated,
  )?.[0];
  if (generatedPackage === undefined) throw new Error('Generated Java has no package declaration.');
  if (!/^package\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*;/mu.test(merged)) {
    throw new Error(`${relocation.previousPath}: Java source has no package declaration.`);
  }
  return merged.replace(
    /^package\s+[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\s*;/mu,
    generatedPackage,
  );
}

/**
 * Older generators kept nested mechanisms exclusively in project.yaml. When such a mechanism is
 * deleted, a newer generator may expect unrelated child wiring in the parent's full-file Java and
 * incorrectly report a layout conflict. If the removed child has no identifier footprint in the
 * existing parent source, preserving that source is the exact semantic deletion and avoids an
 * unsafe whole-file regeneration.
 */
function isLegacyNestedRemovalNoop(
  filePath: string,
  existing: string,
  previous: FrcProjectModel,
  next: FrcProjectModel,
): boolean {
  if (!filePath.endsWith('.java')) return false;
  const nextIds = new Set(next.subsystems.map((subsystem) => subsystem.id));
  const removed = previous.subsystems.filter(
    (subsystem) => subsystem.parentId !== undefined && !nextIds.has(subsystem.id),
  );
  if (removed.length === 0) return false;

  const relevant = removed.filter((subsystem) => {
    const parent = previous.subsystems.find((candidate) => candidate.id === subsystem.parentId);
    return parent !== undefined && subsystemJavaLocation(previous, parent).file === filePath;
  });
  if (relevant.length === 0) return false;

  const relevantParentIds = new Set(relevant.map((subsystem) => subsystem.parentId));
  for (const parentId of relevantParentIds) {
    const oldParent = previous.subsystems.find((subsystem) => subsystem.id === parentId);
    const newParent = next.subsystems.find((subsystem) => subsystem.id === parentId);
    if (
      oldParent === undefined ||
      newParent === undefined ||
      JSON.stringify(oldParent) !== JSON.stringify(newParent)
    ) {
      return false;
    }
    const oldChildren = previous.subsystems.filter((subsystem) => subsystem.parentId === parentId);
    const newChildren = next.subsystems.filter((subsystem) => subsystem.parentId === parentId);
    const survivingOldChildren = oldChildren.filter((subsystem) => nextIds.has(subsystem.id));
    if (JSON.stringify(survivingOldChildren) !== JSON.stringify(newChildren)) return false;
  }

  return relevant.every((subsystem) => !containsJavaIdentifier(existing, subsystem.symbol));
}

function containsJavaIdentifier(source: string, identifier: string): boolean {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_$])${escaped}([^A-Za-z0-9_$]|$)`, 'u').test(source);
}

interface PendingChange {
  readonly id: string;
  readonly command?: DomainCommand;
  readonly model: FrcProjectModel;
  readonly files: ReadonlyMap<string, ProjectFileContent | null>;
  readonly changes: readonly FileChange[];
  readonly problems: readonly string[];
  readonly sourceImport?: boolean;
}

/**
 * Early source imports persisted inferred v5 entities but omitted unmanagedFiles. Newer indexers
 * intentionally exclude Config/Constants/helper classes, so those stale entities would otherwise
 * remain editable and could make a later structured edit generate over handwritten source. Restore
 * source ownership in memory; the next confirmed edit writes the repaired YAML transactionally.
 */
function reconcileLegacySourceImport(
  structured: FrcProjectModel,
  inferred: FrcProjectModel,
): FrcProjectModel {
  const explicitlyUnmanaged = new Set(structured.unmanagedFiles.map(normalizeOverlayPath));
  const inferredUnmanaged = new Set(inferred.unmanagedFiles.map(normalizeOverlayPath));
  const legacyOwnershipDetected =
    structured.subsystems.some(
      (subsystem) =>
        subsystem.javaFile !== undefined &&
        !explicitlyUnmanaged.has(normalizeOverlayPath(subsystem.javaFile)) &&
        inferredUnmanaged.has(normalizeOverlayPath(subsystem.javaFile)) &&
        inferred.subsystems.some((candidate) => candidate.id === subsystem.id),
    ) ||
    structured.commands.some(
      (command) =>
        command.javaFile !== undefined &&
        !explicitlyUnmanaged.has(normalizeOverlayPath(command.javaFile)) &&
        inferredUnmanaged.has(normalizeOverlayPath(command.javaFile)) &&
        inferred.commands.some((candidate) => candidate.id === command.id),
    ) ||
    structured.controllers.some(
      (controller) =>
        isStableSourceId(controller.id) &&
        inferred.controllers.some((candidate) => candidate.id === controller.id),
    );
  const legacySubsystemIds = new Set(
    structured.subsystems
      .filter((subsystem) => {
        if (subsystem.javaFile === undefined || !isStableSourceId(subsystem.id)) return false;
        const file = normalizeOverlayPath(subsystem.javaFile);
        const stillInferred = inferred.subsystems.some(
          (candidate) =>
            candidate.id === subsystem.id ||
            (candidate.symbol === subsystem.symbol &&
              normalizeOverlayPath(candidate.javaFile ?? '') === file),
        );
        return inferredUnmanaged.has(file) && !explicitlyUnmanaged.has(file) && !stillInferred;
      })
      .map((subsystem) => subsystem.id),
  );
  let foundLegacyAncestor = true;
  while (foundLegacyAncestor) {
    foundLegacyAncestor = false;
    for (const subsystem of structured.subsystems) {
      const stillInferred = inferred.subsystems.some(
        (candidate) =>
          candidate.id === subsystem.id ||
          (candidate.symbol === subsystem.symbol &&
            candidate.javaPackage === subsystem.javaPackage),
      );
      if (
        !legacySubsystemIds.has(subsystem.id) &&
        isStableSourceId(subsystem.id) &&
        !stillInferred &&
        structured.subsystems.some(
          (candidate) =>
            legacySubsystemIds.has(candidate.id) && candidate.parentId === subsystem.id,
        )
      ) {
        legacySubsystemIds.add(subsystem.id);
        foundLegacyAncestor = true;
      }
    }
  }

  const legacyCommandIds = new Set(
    structured.commands
      .filter((command) => {
        if (command.javaFile === undefined || !isStableSourceId(command.id)) return false;
        const file = normalizeOverlayPath(command.javaFile);
        const stillInferred = inferred.commands.some(
          (candidate) =>
            candidate.id === command.id ||
            (candidate.symbol === command.symbol &&
              normalizeOverlayPath(candidate.javaFile ?? '') === file),
        );
        return inferredUnmanaged.has(file) && !explicitlyUnmanaged.has(file) && !stillInferred;
      })
      .map((command) => command.id),
  );
  const legacyControllerIds = new Set(
    structured.controllers
      .filter(
        (controller) =>
          isStableSourceId(controller.id) &&
          (structured.bindings.some(
            (binding) =>
              binding.controllerId === controller.id && binding.codeReference !== undefined,
          ) ||
            inferred.controllers.some((candidate) => candidate.id === controller.id)),
      )
      .map((controller) => controller.id),
  );
  if (
    legacySubsystemIds.size === 0 &&
    legacyCommandIds.size === 0 &&
    legacyControllerIds.size === 0 &&
    !legacyOwnershipDetected
  ) {
    return structured;
  }

  const subsystems = structured.subsystems
    .filter((subsystem) => !legacySubsystemIds.has(subsystem.id))
    .map((subsystem) => {
      if (subsystem.parentId === undefined || !legacySubsystemIds.has(subsystem.parentId)) {
        return subsystem;
      }
      const inferredSubsystem = inferred.subsystems.find(
        (candidate) =>
          candidate.id === subsystem.id ||
          (candidate.symbol === subsystem.symbol && candidate.javaFile === subsystem.javaFile),
      );
      const withoutParent = Object.fromEntries(
        Object.entries(subsystem).filter(([key]) => key !== 'parentId'),
      ) as typeof subsystem;
      return inferredSubsystem?.parentId === undefined
        ? withoutParent
        : { ...withoutParent, parentId: inferredSubsystem.parentId };
    });

  return {
    ...structured,
    autos: structured.autos.filter(
      (auto) => auto.commandId === undefined || !legacyCommandIds.has(auto.commandId),
    ),
    bindings: structured.bindings.filter(
      (binding) =>
        !legacyControllerIds.has(binding.controllerId) &&
        (binding.commandId === undefined || !legacyCommandIds.has(binding.commandId)),
    ),
    commands: structured.commands.filter((command) => !legacyCommandIds.has(command.id)),
    controllers: structured.controllers.filter(
      (controller) => !legacyControllerIds.has(controller.id),
    ),
    devices: structured.devices.filter((device) => !legacySubsystemIds.has(device.parentId)),
    subsystems,
    unmanagedFiles: [...new Set([...structured.unmanagedFiles, ...inferred.unmanagedFiles])].sort(),
  };
}

/**
 * Adds read-only entities discovered in Java to the UI model without writing them into project.yaml.
 * Structured entities remain authoritative; source-only entries are replaced from the latest index so
 * deleted or renamed handwritten types do not remain as stale editable nodes.
 */
function mergeSourceOverlay(
  structured: FrcProjectModel,
  inferred: FrcProjectModel,
): FrcProjectModel {
  const unmanaged = new Set(structured.unmanagedFiles.map(normalizeOverlayPath));
  const inferredUnmanaged = new Set(inferred.unmanagedFiles.map(normalizeOverlayPath));
  let generatedPaths = new Set<string>();
  try {
    generatedPaths = new Set(generateStructuredFiles(structured).keys());
  } catch {
    // Invalid projects must remain openable. Explicit unmanaged ownership still wins below.
  }
  const isSourceOwned = (file: string): boolean => {
    const normalized = normalizeOverlayPath(file);
    return (
      inferredUnmanaged.has(normalized) &&
      (unmanaged.has(normalized) || !generatedPaths.has(normalized))
    );
  };
  const sourceSubsystemIds = new Set(
    inferred.subsystems
      .filter((subsystem) => subsystem.javaFile !== undefined && isSourceOwned(subsystem.javaFile))
      .map((subsystem) => subsystem.id),
  );
  let foundSourceAncestor = true;
  while (foundSourceAncestor) {
    foundSourceAncestor = false;
    for (const subsystem of inferred.subsystems) {
      if (
        !sourceSubsystemIds.has(subsystem.id) &&
        inferred.subsystems.some(
          (candidate) =>
            sourceSubsystemIds.has(candidate.id) && candidate.parentId === subsystem.id,
        )
      ) {
        sourceSubsystemIds.add(subsystem.id);
        foundSourceAncestor = true;
      }
    }
  }
  const sourceSubsystems = inferred.subsystems.filter((subsystem) =>
    sourceSubsystemIds.has(subsystem.id),
  );
  const sourceDevices = inferred.devices.filter((device) =>
    sourceSubsystemIds.has(device.parentId),
  );
  const sourceCommands = inferred.commands.filter(
    (command) => command.javaFile !== undefined && isSourceOwned(command.javaFile),
  );
  const sourceCommandIds = new Set(sourceCommands.map((command) => command.id));
  const sourceBindings = inferred.bindings.filter(
    (binding) =>
      binding.codeReference !== undefined &&
      isSourceOwned(binding.codeReference.replace(/:\d+$/u, '')),
  );
  const sourceAutos = inferred.autos.filter(
    (auto) => auto.commandId !== undefined && sourceCommandIds.has(auto.commandId),
  );
  const importedSubsystemIds = new Set(
    structured.subsystems
      .filter(
        (subsystem) =>
          subsystem.javaFile !== undefined &&
          unmanaged.has(normalizeOverlayPath(subsystem.javaFile)),
      )
      .map((subsystem) => subsystem.id),
  );
  let foundImportedAncestor = true;
  while (foundImportedAncestor) {
    foundImportedAncestor = false;
    for (const subsystem of structured.subsystems) {
      if (
        !importedSubsystemIds.has(subsystem.id) &&
        structured.subsystems.some(
          (candidate) =>
            importedSubsystemIds.has(candidate.id) && candidate.parentId === subsystem.id,
        )
      ) {
        importedSubsystemIds.add(subsystem.id);
        foundImportedAncestor = true;
      }
    }
  }

  const subsystems = structured.subsystems.filter(
    (subsystem) => !importedSubsystemIds.has(subsystem.id),
  );
  const inferredToVisibleSubsystem = new Map<string, string>();
  const matchedStructuredSubsystems = new Set<string>();
  for (const subsystem of sourceSubsystems) {
    const match =
      subsystems.find((candidate) => candidate.id === subsystem.id) ??
      subsystems.find(
        (candidate) =>
          !matchedStructuredSubsystems.has(candidate.id) &&
          candidate.symbol === subsystem.symbol &&
          (candidate.javaFile === undefined || candidate.javaFile === subsystem.javaFile),
      );
    const visibleId = match?.id ?? subsystem.id;
    inferredToVisibleSubsystem.set(subsystem.id, visibleId);
    if (match !== undefined) matchedStructuredSubsystems.add(match.id);
  }
  for (const subsystem of sourceSubsystems) {
    if (matchedStructuredSubsystems.has(inferredToVisibleSubsystem.get(subsystem.id) ?? ''))
      continue;
    const metadata = structured.subsystems.find(
      (candidate) =>
        importedSubsystemIds.has(candidate.id) &&
        (candidate.id === subsystem.id ||
          (candidate.symbol === subsystem.symbol && candidate.javaFile === subsystem.javaFile)),
    );
    subsystems.push({
      ...subsystem,
      ...(metadata === undefined ? {} : { displayName: metadata.displayName }),
      ...(metadata?.notes === undefined ? {} : { notes: metadata.notes }),
      ...(metadata?.networkTablesPath === undefined
        ? {}
        : { networkTablesPath: metadata.networkTablesPath }),
      ...(subsystem.parentId === undefined
        ? {}
        : {
            parentId: inferredToVisibleSubsystem.get(subsystem.parentId) ?? subsystem.parentId,
          }),
      ...(subsystem.dependencies === undefined
        ? {}
        : {
            dependencies: subsystem.dependencies.map((dependency) => ({
              ...dependency,
              targetSubsystemId:
                inferredToVisibleSubsystem.get(dependency.targetSubsystemId) ??
                dependency.targetSubsystemId,
            })),
          }),
    });
  }

  const devices = structured.devices.filter((device) => !importedSubsystemIds.has(device.parentId));
  for (const device of sourceDevices) {
    const parentId = inferredToVisibleSubsystem.get(device.parentId) ?? device.parentId;
    if (
      devices.some(
        (candidate) =>
          candidate.id === device.id ||
          (candidate.parentId === parentId && candidate.symbol === device.symbol),
      )
    )
      continue;
    devices.push({ ...device, parentId });
  }

  const importedControllerIds = new Set(
    structured.controllers
      .filter(
        (controller) =>
          isStableSourceId(controller.id) &&
          !inferred.controllers.some((candidate) => candidate.id === controller.id) &&
          structured.bindings.some(
            (binding) =>
              binding.controllerId === controller.id && binding.codeReference !== undefined,
          ),
      )
      .map((controller) => controller.id),
  );
  const controllers = structured.controllers.filter(
    (controller) => !importedControllerIds.has(controller.id),
  );
  const inferredToVisibleController = new Map<string, string>();
  for (const controller of inferred.controllers) {
    const match =
      controllers.find((candidate) => candidate.id === controller.id) ??
      controllers.find(
        (candidate) =>
          candidate.symbol === controller.symbol &&
          candidate.provider === controller.provider &&
          candidate.port === controller.port,
      );
    inferredToVisibleController.set(controller.id, match?.id ?? controller.id);
    if (match === undefined) {
      const metadata = structured.controllers.find(
        (candidate) => importedControllerIds.has(candidate.id) && candidate.id === controller.id,
      );
      controllers.push({
        ...controller,
        ...(metadata === undefined
          ? {}
          : {
              displayName: metadata.displayName,
              role: metadata.role,
              ...(metadata.customRole === undefined ? {} : { customRole: metadata.customRole }),
            }),
      });
    }
  }

  const importedCommandIds = new Set(
    structured.commands
      .filter(
        (command) =>
          command.javaFile !== undefined && unmanaged.has(normalizeOverlayPath(command.javaFile)),
      )
      .map((command) => command.id),
  );
  const commands = structured.commands.filter((command) => !importedCommandIds.has(command.id));
  const inferredToVisibleCommand = new Map<string, string>();
  const matchedStructuredCommands = new Set<string>();
  const symbolCounts = new Map<string, number>();
  for (const command of sourceCommands) {
    symbolCounts.set(command.symbol, (symbolCounts.get(command.symbol) ?? 0) + 1);
  }
  for (const command of sourceCommands) {
    const exact =
      commands.find((candidate) => candidate.id === command.id) ??
      commands.find(
        (candidate) =>
          !matchedStructuredCommands.has(candidate.id) &&
          candidate.javaFile === command.javaFile &&
          candidate.displayName === command.displayName,
      );
    const bySymbol =
      exact ??
      (symbolCounts.get(command.symbol) === 1
        ? commands.find(
            (candidate) =>
              !matchedStructuredCommands.has(candidate.id) && candidate.symbol === command.symbol,
          )
        : undefined);
    if (bySymbol === undefined) {
      const metadata = structured.commands.find(
        (candidate) =>
          importedCommandIds.has(candidate.id) &&
          (candidate.id === command.id ||
            (candidate.symbol === command.symbol && candidate.javaFile === command.javaFile)),
      );
      commands.push({
        ...command,
        ...(metadata === undefined ? {} : { displayName: metadata.displayName }),
        ...(metadata?.notes === undefined ? {} : { notes: metadata.notes }),
      });
      inferredToVisibleCommand.set(command.id, command.id);
    } else {
      matchedStructuredCommands.add(bySymbol.id);
      inferredToVisibleCommand.set(command.id, bySymbol.id);
    }
  }

  const bindings = structured.bindings.filter((binding) => binding.codeReference === undefined);
  for (const binding of sourceBindings) {
    const controllerId =
      inferredToVisibleController.get(binding.controllerId) ?? binding.controllerId;
    const commandId =
      binding.commandId === undefined
        ? undefined
        : (inferredToVisibleCommand.get(binding.commandId) ?? binding.commandId);
    if (
      bindings.some(
        (candidate) =>
          candidate.id === binding.id ||
          (candidate.controllerId === controllerId &&
            candidate.commandId === commandId &&
            candidate.input === binding.input &&
            candidate.behavior === binding.behavior),
      )
    )
      continue;
    bindings.push({
      ...binding,
      controllerId,
      ...(commandId === undefined ? {} : { commandId }),
    });
  }

  const autos = structured.autos.filter(
    (auto) => auto.commandId === undefined || !importedCommandIds.has(auto.commandId),
  );
  for (const auto of sourceAutos) {
    const commandId =
      auto.commandId === undefined
        ? undefined
        : (inferredToVisibleCommand.get(auto.commandId) ?? auto.commandId);
    if (
      autos.some(
        (candidate) =>
          candidate.id === auto.id ||
          (candidate.symbol === auto.symbol && candidate.commandId === commandId),
      )
    )
      continue;
    autos.push({
      ...auto,
      ...(commandId === undefined ? {} : { commandId }),
    });
  }
  return {
    ...structured,
    autos,
    bindings,
    commands,
    controllers,
    devices,
    subsystems,
    unmanagedFiles: [
      ...new Set([
        ...structured.unmanagedFiles,
        ...inferred.unmanagedFiles.filter((file) => isSourceOwned(file)),
      ]),
    ].sort(),
  };
}

function normalizeOverlayPath(value: string): string {
  return value.replace(/\\/gu, '/');
}

function isStableSourceId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}

async function detectDirectoryKind(
  directoryPath: string,
  entries: readonly string[],
): Promise<DirectoryKind> {
  if (entries.length === 0) {
    return 'empty';
  }
  const frcMarkers = [
    'project.yaml',
    'build.gradle',
    'build.gradle.kts',
    'settings.gradle',
    'settings.gradle.kts',
    'CMakeLists.txt',
    'pom.xml',
  ];
  for (const marker of frcMarkers) {
    if (entries.includes(marker) && (await stat(path.join(directoryPath, marker))).isFile()) {
      return 'frc-project';
    }
  }
  if (
    entries.includes('src') &&
    (await directoryExists(path.join(directoryPath, 'src'))) &&
    (entries.includes('.wpilib') || entries.includes('vendordeps'))
  ) {
    return 'frc-project';
  }
  return 'directory';
}

async function countJavaFiles(root: string): Promise<number> {
  const sourceRoot = path.join(root, 'src');
  try {
    const entries = await readdir(sourceRoot, { recursive: true, withFileTypes: true });
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.java')).length;
  } catch {
    return 0;
  }
}

async function createBrowseOnlyModel(root: string): Promise<FrcProjectModel> {
  let teamNumber = 1;
  try {
    const preferences = JSON.parse(
      (await readOptional(path.join(root, '.wpilib', 'wpilib_preferences.json'))) ?? '{}',
    ) as { teamNumber?: number };
    if (Number.isInteger(preferences.teamNumber) && (preferences.teamNumber ?? 0) > 0)
      teamNumber = preferences.teamNumber ?? 1;
  } catch {
    // Browsing does not require valid WPILib preferences.
  }
  let wpilibYear = new Date().getUTCFullYear();
  for (const buildFile of ['build.gradle', 'build.gradle.kts']) {
    const build = await readOptional(path.join(root, buildFile));
    const year =
      build === undefined ? undefined : /GradleRIO[^\n]*?["']((?:20)\d{2})\./u.exec(build)?.[1];
    if (year !== undefined) {
      wpilibYear = Number(year);
      break;
    }
  }
  return createEmptyProject({
    javaPackage: 'frc.robot',
    name: path.basename(root),
    teamNumber,
    wpilibYear,
  });
}

async function sourceFiles(
  root: string,
  report?: SourceImportReport,
  externallyModified: ReadonlySet<string> = new Set(),
): Promise<readonly ProjectSourceFile[]> {
  const files: ProjectSourceFile[] = [];
  const indexed = new Map(report?.files.map((file) => [file.path.replace(/\\/gu, '/'), file]));
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const child = path.join(directory, entry.name);
      const relativePath = path.relative(root, child).replace(/\\/gu, '/');
      if (entry.isDirectory()) {
        if (!isIgnoredProjectPath(relativePath)) await visit(child);
      } else if (entry.isFile()) {
        const descriptor = classifyProjectFile(relativePath);
        if (descriptor === undefined) continue;
        const index = indexed.get(relativePath);
        const metadata = await stat(child);
        const content =
          descriptor.binary || metadata.size > 1_000_000 ? undefined : await readOptional(child);
        const ownership =
          index?.classification ??
          (content?.includes('<frc-framework:managed>') === true
            ? 'managed'
            : content?.includes('<frc-framework:recognized>') === true
              ? 'recognized'
              : 'custom');
        files.push({
          binary: descriptor.binary,
          externallyModified: externallyModified.has(relativePath),
          format: descriptor.format,
          kind: descriptor.kind,
          ownership,
          path: relativePath,
          problemCount: index?.index.problems.length ?? 0,
          size: metadata.size,
          ...(index === undefined ? {} : { symbols: sourceSymbols(index.index) }),
        });
      }
    }
  };
  await visit(root);
  return files;
}

function sourceSymbols(
  index: SourceImportReport['files'][number]['index'],
): NonNullable<ProjectSourceFile['symbols']> {
  const point = (
    label: string,
    kind: NonNullable<ProjectSourceFile['symbols']>[number]['kind'],
    range: { readonly start: { readonly row: number; readonly column: number } },
  ) => ({ column: range.start.column + 1, kind, label, line: range.start.row + 1 });
  const commandMethods = new Set(
    index.commandMethods.map(
      (method) => `${method.name}:${method.parameters}:${String(method.range.start.row)}`,
    ),
  );
  return [
    ...index.types.flatMap((type) => [
      point(type.name, 'type', type.range),
      ...type.fields.map((field) => point(`${field.type} ${field.name}`, 'field', field.range)),
      ...type.methods.flatMap((method) =>
        commandMethods.has(`${method.name}:${method.parameters}:${String(method.range.start.row)}`)
          ? []
          : [point(`${method.name}${method.parameters}`, 'method', method.range)],
      ),
    ]),
    ...index.commandMethods.map((method) =>
      point(`${method.name}${method.parameters}`, 'command', method.range),
    ),
    ...index.bindings.map((binding) =>
      point(`${binding.triggerExpression}.${binding.event}`, 'binding', binding.range),
    ),
    ...index.states.map((state) => point(state.name, 'state', state.range)),
  ].sort((left, right) => left.line - right.line || left.column - right.column);
}

async function readOptional(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function textCandidate(
  files: ReadonlyMap<string, ProjectFileContent | null>,
): ReadonlyMap<string, string | null> {
  return new Map(
    [...files].map(([filePath, content]) => [
      filePath,
      content === null ? null : typeof content === 'string' ? content : '',
    ]),
  );
}

async function directoryExists(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}

async function validateAutoResources(
  root: string,
  model: FrcProjectModel,
): Promise<readonly string[]> {
  const problems: string[] = [];
  const namedCommands = new Set(
    model.commands
      .map((command) => command.pathplannerName)
      .filter((name): name is string => name !== undefined),
  );
  const inspected = new Set<string>();
  for (const auto of model.autos) {
    for (const relative of auto.pathFiles) {
      const normalized = relative.replace(/\\/gu, '/');
      const deployRelative = normalized.startsWith('src/main/deploy/')
        ? normalized
        : `src/main/deploy/${normalized}`;
      if (inspected.has(deployRelative)) continue;
      inspected.add(deployRelative);
      const filePath = path.resolve(root, deployRelative);
      if (!isWithin(root, filePath)) {
        problems.push(`Auto ${auto.displayName}: unsafe path ${relative}.`);
        continue;
      }
      const content = await readOptional(filePath);
      if (content === undefined) {
        problems.push(`Auto ${auto.displayName}: missing ${deployRelative}.`);
        continue;
      }
      if (!filePath.endsWith('.auto') && !filePath.endsWith('.path')) continue;
      try {
        const document = JSON.parse(content) as unknown;
        const references = collectPathPlannerReferences(document);
        for (const name of references.namedCommands) {
          if (!namedCommands.has(name)) {
            problems.push(
              `Auto ${auto.displayName}: PathPlanner named command "${name}" is not configured.`,
            );
          }
        }
        for (const pathName of references.paths) {
          const referencedPath = path.join(
            root,
            'src',
            'main',
            'deploy',
            'pathplanner',
            'paths',
            `${pathName}.path`,
          );
          if ((await readOptional(referencedPath)) === undefined) {
            problems.push(
              `Auto ${auto.displayName}: referenced PathPlanner path "${pathName}" is missing.`,
            );
          }
        }
      } catch {
        problems.push(`Auto ${auto.displayName}: ${deployRelative} is not valid JSON.`);
      }
    }
  }
  return problems;
}

function collectPathPlannerReferences(value: unknown): {
  readonly namedCommands: ReadonlySet<string>;
  readonly paths: ReadonlySet<string>;
} {
  const namedCommands = new Set<string>();
  const paths = new Set<string>();
  const visit = (current: unknown): void => {
    if (Array.isArray(current)) {
      current.forEach(visit);
      return;
    }
    if (typeof current !== 'object' || current === null) return;
    const record = current as Record<string, unknown>;
    const data =
      typeof record.data === 'object' && record.data !== null
        ? (record.data as Record<string, unknown>)
        : undefined;
    if (record.type === 'named' && typeof data?.name === 'string') namedCommands.add(data.name);
    if (record.type === 'path' && typeof data?.pathName === 'string') paths.add(data.pathName);
    Object.values(record).forEach(visit);
  };
  visit(value);
  return { namedCommands, paths };
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative.length === 0 || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (
    normalized.length === 0 ||
    path.posix.isAbsolute(normalized) ||
    normalized.split('/').includes('..')
  ) {
    throw new Error('External change path must be project-relative.');
  }
  return normalized;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function validatePresetCompatibility(model: FrcProjectModel): readonly string[] {
  const manifests = new Map(PRESET_MANIFESTS.map((manifest) => [manifest.id, manifest]));
  return model.presets.flatMap((preset) => {
    const manifest = manifests.get(preset.presetId);
    if (manifest === undefined) return [`Unknown preset ${preset.presetId}.`];
    if (preset.version > manifest.version) {
      return [
        `Preset ${preset.presetId} v${String(preset.version)} is newer than supported v${String(manifest.version)}.`,
      ];
    }
    if (!manifest.wpilibYears.includes(model.project.wpilibYear)) {
      return [
        `Preset ${preset.presetId} does not support WPILib ${String(model.project.wpilibYear)}.`,
      ];
    }
    return [];
  });
}
