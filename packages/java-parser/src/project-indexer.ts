import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  createEmptyProject,
  javaSymbol,
  type AutoRoutine,
  type CommandDefinition,
  type ControlBinding,
  type Controller,
  type Device,
  type FrcProjectModel,
  type Subsystem,
} from '@frc-framework/domain';

import { JavaParserService, type JavaParserOptions } from './java-parser.js';
import type { JavaSourceIndex, SourceClassification } from './types.js';

export interface IndexedProjectFile {
  readonly path: string;
  readonly classification: SourceClassification;
  readonly confidence: number;
  readonly hasSyntaxErrors: boolean;
  readonly index: JavaSourceIndex;
}

export interface SourceImportReport {
  readonly model: FrcProjectModel;
  readonly files: readonly IndexedProjectFile[];
  readonly recognizedFiles: readonly string[];
  readonly partialFiles: readonly string[];
  readonly customFiles: readonly string[];
  readonly problems: readonly string[];
  readonly vendordeps: readonly string[];
  readonly cacheHits: number;
  readonly parsedFiles: number;
}

interface CachedIndex {
  readonly signature: string;
  readonly index: JavaSourceIndex;
}

export class JavaProjectIndexer {
  readonly #parser: JavaParserService;
  readonly #cache = new Map<string, CachedIndex>();

  private constructor(parser: JavaParserService) {
    this.#parser = parser;
  }

  static async create(options: JavaParserOptions = {}): Promise<JavaProjectIndexer> {
    return new JavaProjectIndexer(await JavaParserService.create(options));
  }

  async indexProject(projectRoot: string): Promise<SourceImportReport> {
    const javaPaths = await listJavaFiles(projectRoot);
    const files: IndexedProjectFile[] = [];
    let cacheHits = 0;
    for (const filePath of javaPaths) {
      const metadata = await stat(filePath);
      const signature = `${String(metadata.size)}:${String(metadata.mtimeMs)}`;
      let index =
        this.#cache.get(filePath)?.signature === signature
          ? this.#cache.get(filePath)?.index
          : undefined;
      if (index === undefined) {
        index = this.#parser.index(await readFile(filePath, 'utf8'));
        this.#cache.set(filePath, { index, signature });
      } else cacheHits += 1;
      files.push({
        classification: index.ownership.classification,
        confidence: index.ownership.confidence,
        hasSyntaxErrors: index.hasSyntaxErrors,
        index,
        path: normalize(path.relative(projectRoot, filePath)),
      });
    }
    const metadata = await projectMetadata(projectRoot, files);
    const model = inferModel(projectRoot, files, metadata);
    const partialFiles = files
      .filter(
        (file) =>
          file.hasSyntaxErrors || (file.classification === 'recognized' && file.confidence < 0.75),
      )
      .map((file) => file.path);
    const partial = new Set(partialFiles);
    return {
      cacheHits,
      customFiles: files
        .filter((file) => file.classification === 'custom' && !partial.has(file.path))
        .map((file) => file.path),
      files,
      model,
      parsedFiles: files.length - cacheHits,
      partialFiles,
      problems: metadata.problems,
      recognizedFiles: files
        .filter((file) => file.classification !== 'custom' && !partial.has(file.path))
        .map((file) => file.path),
      vendordeps: metadata.vendordeps,
    };
  }

  dispose(): void {
    this.#parser.dispose();
    this.#cache.clear();
  }
}

interface ProjectMetadata {
  readonly javaPackage: string;
  readonly teamNumber: number;
  readonly wpilibYear: number;
  readonly problems: readonly string[];
  readonly vendordeps: readonly string[];
}

async function projectMetadata(
  root: string,
  files: readonly IndexedProjectFile[],
): Promise<ProjectMetadata> {
  const problems: string[] = [];
  const robotFile = files.find(
    (file) =>
      file.path.endsWith('/Robot.java') || file.path === 'src/main/java/frc/robot/Robot.java',
  );
  const javaPackage =
    robotFile?.index.packageName ??
    files.find((file) => file.index.packageName !== undefined)?.index.packageName ??
    'frc.robot';
  let teamNumber = 1;
  try {
    const preferences = JSON.parse(
      await readFile(path.join(root, '.wpilib', 'wpilib_preferences.json'), 'utf8'),
    ) as { teamNumber?: number };
    if (Number.isInteger(preferences.teamNumber) && (preferences.teamNumber ?? 0) > 0)
      teamNumber = preferences.teamNumber ?? 1;
  } catch {
    problems.push('Team number could not be read; using 1 until it is confirmed.');
  }
  let wpilibYear = new Date().getUTCFullYear();
  try {
    const build = await readFile(path.join(root, 'build.gradle'), 'utf8');
    const year = /GradleRIO[^\n]*?["']((?:20)\d{2})\./u.exec(build)?.[1];
    if (year !== undefined) wpilibYear = Number(year);
    const buildTeam = /\bteam\s*=\s*(\d+)/u.exec(build)?.[1];
    if (teamNumber === 1 && buildTeam !== undefined) teamNumber = Number(buildTeam);
  } catch {
    problems.push(
      'build.gradle could not be read; WPILib year was inferred from the current year.',
    );
  }
  let vendordeps: string[] = [];
  try {
    vendordeps = (await readdir(path.join(root, 'vendordeps')))
      .filter((name) => name.endsWith('.json'))
      .sort();
  } catch {
    // Vendordeps are optional.
  }
  return { javaPackage, problems, teamNumber, vendordeps, wpilibYear };
}

function inferModel(
  root: string,
  files: readonly IndexedProjectFile[],
  metadata: ProjectMetadata,
): FrcProjectModel {
  const name = path.basename(root);
  const base = createEmptyProject({
    id: stableId(`project:${normalize(root)}`),
    javaPackage: metadata.javaPackage,
    name,
    teamNumber: metadata.teamNumber,
    wpilibYear: metadata.wpilibYear,
  });
  const subsystems = inferSubsystems(files, metadata.javaPackage);
  const subsystemByFile = new Map<string, Subsystem>();
  for (const file of files) {
    const typeName = file.index.types[0]?.name;
    const node = subsystems.find(
      (entry) => entry.javaFile === file.path && entry.symbol === typeName,
    );
    if (node !== undefined) subsystemByFile.set(file.path, node);
  }
  const devices = inferDevices(files, subsystemByFile);
  const controllers = inferControllers(files);
  const commands = inferCommands(files);
  const controllerByField = new Map(controllers.map((entry) => [entry.symbol, entry]));
  const bindings = inferBindings(files, controllerByField, commands);
  const autos = inferAutos(files, commands);
  return {
    ...base,
    autos,
    bindings,
    commands,
    controllers,
    devices,
    project: { ...base.project, symbol: javaSymbol(name) },
    robot: { ...base.robot, id: stableId('robot') },
    subsystems,
  };
}

function inferAutos(
  files: readonly IndexedProjectFile[],
  commands: readonly CommandDefinition[],
): readonly AutoRoutine[] {
  return files.flatMap((file) => {
    const autoType = file.index.types.find(
      (type) => type.kind === 'class' && /(?:Auto|Routine)/iu.test(type.name),
    );
    if (!file.path.includes('/auto/') || autoType === undefined) return [];
    return file.index.commandMethods.flatMap((method) => {
      if (method.name === 'configure') return [];
      const displayName = `${method.name}${method.parameters}`;
      const command = commands.find(
        (entry) =>
          entry.javaFile === file.path &&
          entry.symbol === method.name &&
          entry.displayName === displayName,
      );
      if (command === undefined) return [];
      return [
        {
          commandId: command.id,
          displayName,
          id: stableId(`auto:${file.path}:${method.name}:${method.parameters}`),
          pathFiles: [],
          symbol: method.name,
        },
      ];
    });
  });
}

function inferSubsystems(
  files: readonly IndexedProjectFile[],
  basePackage: string,
): readonly Subsystem[] {
  const result = new Map<string, Subsystem>();
  for (const file of files) {
    const match = /(?:^|\/)subsystems\/(.+)\.java$/u.exec(file.path);
    const primary = file.index.types.find((type) => type.kind === 'class');
    if (match === null || primary === undefined) continue;
    const segments = match[1]?.split('/') ?? [];
    const rootSymbol = javaSymbol(
      segments.length > 1 ? (segments[0] ?? primary.name) : primary.name,
    );
    const rootId = stableId(`subsystem:${rootSymbol}`);
    if (!result.has(rootId)) {
      result.set(rootId, {
        behaviorMode: file.index.states.some((state) => state.role === 'goal')
          ? 'goal-driven'
          : 'custom',
        displayName: rootSymbol,
        id: rootId,
        javaPackage: `${basePackage}.subsystems${segments.length > 1 ? `.${segments[0] ?? ''}` : ''}`,
        kind: 'subsystem',
        realImplementation: true,
        simulationImplementation: file.index.patterns.some((pattern) =>
          pattern.symbol.includes('Sim'),
        ),
        symbol: rootSymbol,
      });
    }
    if (primary.name !== rootSymbol) {
      const id = stableId(`mechanism:${file.path}:${primary.name}`);
      result.set(id, {
        behaviorMode: file.index.commandMethods.length > 0 ? 'custom' : 'direct',
        displayName: primary.name,
        id,
        javaFile: file.path,
        ...(file.index.packageName === undefined ? {} : { javaPackage: file.index.packageName }),
        kind: primary.name.toLowerCase().includes('superstructure') ? 'group' : 'mechanism',
        parentId: rootId,
        symbol: primary.name,
      });
    } else {
      result.set(rootId, {
        ...result.get(rootId)!,
        javaFile: file.path,
        ...(file.index.packageName === undefined ? {} : { javaPackage: file.index.packageName }),
      });
    }
  }
  return [...result.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

function inferDevices(
  files: readonly IndexedProjectFile[],
  subsystemByFile: ReadonlyMap<string, Subsystem>,
): readonly Device[] {
  const devices: Device[] = [];
  for (const file of files) {
    const parent = subsystemByFile.get(file.path);
    if (parent === undefined) continue;
    const motorFields = file.index.types
      .flatMap((type) => type.fields)
      .filter((field) => /Motor(?:IO|Subsystem)|TalonFX/u.test(field.type));
    for (const field of motorFields) {
      devices.push({
        catalogId: 'ironpulse.talonfx-primary',
        displayName: field.name,
        id: stableId(`device:${file.path}:${field.name}`),
        kind: 'motor',
        model: field.type,
        parameters: [],
        parentId: parent.id,
        role: 'recognized-from-code',
        symbol: javaSymbol(field.name),
        vendor: 'IronPulse / CTRE',
      });
    }
  }
  return devices;
}

function inferControllers(files: readonly IndexedProjectFile[]): readonly Controller[] {
  const controllers: Controller[] = [];
  for (const file of files) {
    for (const declaration of file.index.controllers) {
      if (controllers.some((entry) => entry.symbol === declaration.fieldName)) continue;
      controllers.push({
        displayName: declaration.fieldName,
        id: stableId(`controller:${file.path}:${declaration.fieldName}`),
        port: controllers.length,
        provider: declaration.controllerType,
        role: /operator|copilot|manipulator/iu.test(declaration.fieldName) ? 'operator' : 'driver',
        symbol: declaration.fieldName,
      });
    }
  }
  return controllers;
}

function inferCommands(files: readonly IndexedProjectFile[]): readonly CommandDefinition[] {
  return files.flatMap((file) =>
    file.index.commandMethods.map((method) => ({
      displayName: `${method.name}${method.parameters}`,
      id: stableId(`command:${file.path}:${method.name}:${method.parameters}`),
      javaFile: file.path,
      kind: 'custom' as const,
      requirementIds: [],
      symbol: method.name,
    })),
  );
}

function inferBindings(
  files: readonly IndexedProjectFile[],
  controllerByField: ReadonlyMap<string, Controller>,
  commands: readonly CommandDefinition[],
): readonly ControlBinding[] {
  const commandBySymbol = new Map<string, CommandDefinition>();
  for (const command of commands) {
    if (!commandBySymbol.has(command.symbol)) commandBySymbol.set(command.symbol, command);
  }
  return files.flatMap((file) =>
    file.index.bindings.flatMap((binding, index) => {
      const controllerName = /^([A-Za-z_$][\w$]*)/u.exec(binding.triggerExpression)?.[1];
      const controller =
        controllerName === undefined ? undefined : controllerByField.get(controllerName);
      if (controller === undefined) return [];
      const commandName = /^([A-Za-z_$][\w$]*)\s*\(/u.exec(binding.commandExpression)?.[1];
      const command = commandName === undefined ? undefined : commandBySymbol.get(commandName);
      const supported = ['onTrue', 'onFalse', 'whileTrue', 'toggleOnTrue'] as const;
      const behavior = supported.find((entry) => entry === binding.event) ?? 'custom';
      return [
        {
          behavior,
          ...(command === undefined ? {} : { commandId: command.id }),
          codeReference: `${file.path}:${String(binding.range.start.row + 1)}`,
          controllerId: controller.id,
          id: stableId(`binding:${file.path}:${String(index)}:${binding.triggerExpression}`),
          input: binding.triggerExpression,
        },
      ];
    }),
  );
}

async function listJavaFiles(root: string): Promise<readonly string[]> {
  const result: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === 'build' || entry.name === '.gradle' || entry.name === '.frc-framework')
        continue;
      const child = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && entry.name.endsWith('.java')) result.push(child);
    }
  };
  await visit(path.join(root, 'src'));
  return result;
}

function stableId(value: string): string {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalize(value: string): string {
  return value.replace(/\\/gu, '/');
}
