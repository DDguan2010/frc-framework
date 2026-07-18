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
  isSafeAutoApply,
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
      const visibleModel =
        parsed.model === undefined || sourceReport === undefined
          ? parsed.model
          : mergeSourceOverlay(parsed.model, sourceReport.model);
      result = {
        displayName: visibleModel?.project.displayName ?? path.basename(root),
        mode: 'yaml',
        ...(visibleModel === undefined ? {} : { model: visibleModel }),
        path: root,
        problems: [
          ...parsed.problems.map((problem) => problem.message),
          ...(parsed.model === undefined
            ? []
            : [
                ...validateModel(parsed.model).map((problem) => problem.message),
                ...validatePresetCompatibility(parsed.model),
                ...(await validateAutoResources(root, parsed.model)),
              ]),
        ],
        readOnly,
        sourceFiles: await sourceFiles(
          root,
          sourceReport,
          this.#externalFiles,
          parsed.model?.unmanagedFiles,
        ),
      };
      this.#session = parsed.model === undefined ? undefined : new DomainSession(parsed.model);
      this.#sourceImportPending = false;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }
      const javaFiles = await countJavaFiles(root);
      let report: SourceImportReport | undefined;
      if (javaFiles > 0)
        report = await this.#javaIndexer().then((indexer) => indexer.indexProject(root));
      result = {
        displayName: path.basename(root),
        mode: 'source',
        ...(report === undefined ? {} : { model: report.model }),
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
        problems:
          javaFiles === 0
            ? ['No project.yaml or Java source files were found.']
            : [
                `project.yaml is missing; source fallback found ${String(javaFiles)} Java files.`,
                ...(report?.problems ?? []),
              ],
        readOnly,
        sourceFiles: await sourceFiles(
          root,
          report,
          this.#externalFiles,
          report?.model.unmanagedFiles,
        ),
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
    generated.set('project.yaml', stringifyProjectYaml(model));
    for (const [filePath, content] of nextGenerated) {
      if (model.unmanagedFiles.includes(filePath)) continue;
      if (typeof content !== 'string') {
        generated.set(filePath, content);
        continue;
      }
      const existing = await readOptional(path.join(root, filePath));
      const previous = previousGenerated.get(filePath);
      const forced = forceGeneratedPaths.has(filePath);
      // Do not touch a generated path when this command did not change its
      // expected output. This isolates structured edits from stale
      // files produced by an older FRC Framework version and from unrelated
      // team-owned edits. Missing legacy files are repaired only through the
      // explicit Regenerate action instead of being mixed into another edit.
      if (!forced && !includeUnchangedPaths.has(filePath) && previous === content) continue;
      try {
        generated.set(
          filePath,
          forced
            ? content
            : typeof previous === 'string' &&
                (existing === previous ||
                  (filePath.endsWith('.java') && sameGeneratedJava(existing, previous)))
              ? content
              : filePath.endsWith('.java')
                ? mergeGeneratedJava(existing, content)
                : filePath.endsWith('.md')
                  ? mergeGeneratedDocument(existing, content)
                  : content,
        );
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
      hasPendingChanges: () => this.#pending !== undefined,
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
      sourceFiles: await sourceFiles(root, report, this.#externalFiles, model.unmanagedFiles),
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

  async #sourceFiles(
    root: string,
    model = this.#session?.model,
  ): Promise<readonly ProjectSourceFile[]> {
    const report = await this.#sourceReport(root);
    return sourceFiles(root, report, this.#externalFiles, model?.unmanagedFiles);
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
 * Adds read-only entities discovered in Java to the UI model without writing them into project.yaml.
 * Structured entities remain authoritative; source-only entries are rediscovered after every refresh.
 */
function mergeSourceOverlay(
  structured: FrcProjectModel,
  inferred: FrcProjectModel,
): FrcProjectModel {
  const commands = [...structured.commands];
  const inferredToVisibleCommand = new Map<string, string>();
  const matchedStructuredCommands = new Set<string>();
  const symbolCounts = new Map<string, number>();
  for (const command of inferred.commands) {
    symbolCounts.set(command.symbol, (symbolCounts.get(command.symbol) ?? 0) + 1);
  }
  for (const command of inferred.commands) {
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
      commands.push(command);
      inferredToVisibleCommand.set(command.id, command.id);
    } else {
      matchedStructuredCommands.add(bySymbol.id);
      inferredToVisibleCommand.set(command.id, bySymbol.id);
    }
  }

  const autos = [...structured.autos];
  for (const auto of inferred.autos) {
    if (autos.some((candidate) => candidate.symbol === auto.symbol)) continue;
    autos.push({
      ...auto,
      ...(auto.commandId === undefined
        ? {}
        : { commandId: inferredToVisibleCommand.get(auto.commandId) ?? auto.commandId }),
    });
  }
  return { ...structured, autos, commands };
}

async function detectDirectoryKind(
  directoryPath: string,
  entries: readonly string[],
): Promise<DirectoryKind> {
  if (entries.length === 0) {
    return 'empty';
  }
  const frcMarkers = ['project.yaml', 'build.gradle', 'build.gradle.kts', 'settings.gradle'];
  for (const marker of frcMarkers) {
    if (entries.includes(marker) && (await stat(path.join(directoryPath, marker))).isFile()) {
      return 'frc-project';
    }
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

async function sourceFiles(
  root: string,
  report?: SourceImportReport,
  externallyModified: ReadonlySet<string> = new Set(),
  unmanagedFiles: readonly string[] = [],
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
      if (entry.name === '.frc-framework' || entry.name === 'build' || entry.name === '.gradle')
        continue;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && /\.(?:java|gradle|json|md|ya?ml)$/u.test(entry.name)) {
        const relativePath = path.relative(root, child).replace(/\\/gu, '/');
        const index = indexed.get(relativePath);
        const content = await readOptional(child);
        const ownership = unmanagedFiles.includes(relativePath)
          ? 'custom'
          : (index?.classification ??
            (content?.includes('<frc-framework:managed>') === true
              ? 'managed'
              : content?.includes('<frc-framework:recognized>') === true
                ? 'recognized'
                : 'custom'));
        files.push({
          externallyModified: externallyModified.has(relativePath),
          ownership,
          path: relativePath,
          problemCount: index?.index.problems.length ?? 0,
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
  return [
    ...index.types.flatMap((type) => [
      point(type.name, 'type', type.range),
      ...type.fields.map((field) => point(`${field.type} ${field.name}`, 'field', field.range)),
      ...type.methods.map((method) =>
        point(`${method.name}(${method.parameters})`, 'method', method.range),
      ),
    ]),
    ...index.commandMethods.map((method) => point(method.name, 'command', method.range)),
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
