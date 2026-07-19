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
import type { JavaSourceIndex, JavaType, SourceClassification } from './types.js';

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
      /\/(?:Robot|RobotContainer|Main)\.java$/u.test(file.path) ||
      /^(?:Robot|RobotContainer|Main)\.java$/u.test(file.path),
  );
  const javaPackage =
    robotFile?.index.packageName ??
    inferBasePackage(
      files.flatMap((file) =>
        file.index.packageName === undefined ? [] : [file.index.packageName],
      ),
    ) ??
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

function inferBasePackage(packages: readonly string[]): string | undefined {
  if (packages.length === 0) return undefined;
  const split = packages.map((packageName) => packageName.split('.'));
  const shortest = Math.min(...split.map((segments) => segments.length));
  const common: string[] = [];
  for (let index = 0; index < shortest; index += 1) {
    const segment = split[0]?.[index];
    if (segment === undefined || split.some((segments) => segments[index] !== segment)) break;
    common.push(segment);
  }
  if (common.length >= 2) return common.join('.');

  const first = split[0] ?? [];
  const structuralIndex = first.findIndex((segment) =>
    /^(?:auto|commands?|constants?|subsystems?|mechanisms?)$/iu.test(segment),
  );
  if (structuralIndex >= 2) return first.slice(0, structuralIndex).join('.');
  return packages[0];
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
  const controllers = inferControllers(files, metadata.javaPackage);
  const commands = inferCommands(files, metadata.javaPackage);
  const controllerByField = new Map(controllers.map((entry) => [entry.symbol, entry]));
  const bindings = inferBindings(files, metadata.javaPackage, controllerByField, commands);
  const autos = inferAutos(files, metadata.javaPackage, commands);
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
    unmanagedFiles: files
      .filter((file) => file.classification !== 'managed')
      .map((file) => file.path)
      .sort(),
  };
}

function inferAutos(
  files: readonly IndexedProjectFile[],
  basePackage: string,
  commands: readonly CommandDefinition[],
): readonly AutoRoutine[] {
  return files.flatMap((file) => {
    if (!isRobotRuntimeSource(file, basePackage)) return [];
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
  const candidates = files.flatMap((file) => {
    if (!isRobotRuntimeSource(file, basePackage)) return [];
    const match = /(?:^|\/)(?:subsystems?|mechanisms?)\/(.+)\.java$/iu.exec(file.path);
    const primary = file.index.types.find((type) => type.kind === 'class');
    if (match === null || primary === undefined) return [];
    const segments = match[1]?.split('/') ?? [];
    const directories = segments.slice(0, -1);
    const directory = directories.join('/');
    const ownsDirectory =
      directories.length > 0 &&
      (javaSymbol(directories.at(-1) ?? '').toLowerCase() === primary.name.toLowerCase() ||
        primary.name.endsWith('Subsystem'));
    if (!isSubsystemCandidate(file, primary, ownsDirectory)) return [];
    return [{ directories, directory, file, ownsDirectory, primary }];
  });
  const directoryOwners = new Map(
    candidates
      .filter((candidate) => candidate.ownsDirectory)
      .map((candidate) => [candidate.directory.toLowerCase(), candidate]),
  );
  const actualIds = new Map(
    candidates.map((candidate) => [
      candidate.file.path,
      stableId(`subsystem:${candidate.file.path}:${candidate.primary.name}`),
    ]),
  );
  const syntheticRoots = new Map<string, Subsystem>();
  const result: Subsystem[] = [];
  for (const candidate of candidates) {
    const { directories, file, ownsDirectory, primary } = candidate;
    const nodeId = actualIds.get(file.path)!;
    const searchLength = ownsDirectory ? directories.length - 1 : directories.length;
    let parentId: Subsystem['parentId'];
    for (let length = searchLength; length > 0; length -= 1) {
      const owner = directoryOwners.get(directories.slice(0, length).join('/').toLowerCase());
      if (owner !== undefined && owner.file.path !== file.path) {
        parentId = actualIds.get(owner.file.path);
        break;
      }
    }
    if (parentId === undefined && directories.length > 0) {
      const rootDirectory = directories[0] ?? '';
      const rootOwner = directoryOwners.get(rootDirectory.toLowerCase());
      if (rootOwner === undefined) {
        const rootSymbol = javaSymbol(rootDirectory || primary.name);
        const rootId = stableId(`subsystem-folder:${rootDirectory.toLowerCase()}`);
        if (!syntheticRoots.has(rootDirectory.toLowerCase())) {
          syntheticRoots.set(rootDirectory.toLowerCase(), {
            behaviorMode: 'custom',
            displayName: rootSymbol,
            id: rootId,
            javaPackage: `${basePackage}.subsystems.${rootDirectory}`,
            kind: 'subsystem',
            realImplementation: true,
            simulationImplementation: false,
            symbol: rootSymbol,
          });
        }
        parentId = rootId;
      }
    }
    result.push({
      behaviorMode: file.index.states.some(
        (state) => state.role === 'goal' || state.role === 'state',
      )
        ? 'goal-driven'
        : file.index.commandMethods.length > 0
          ? 'custom'
          : 'direct',
      displayName: primary.name,
      id: nodeId,
      javaFile: file.path,
      ...(file.index.packageName === undefined ? {} : { javaPackage: file.index.packageName }),
      kind:
        parentId === undefined
          ? 'subsystem'
          : primary.name.toLowerCase().includes('superstructure')
            ? 'group'
            : 'mechanism',
      ...(parentId === undefined ? {} : { parentId }),
      realImplementation: true,
      simulationImplementation: file.index.patterns.some((pattern) =>
        pattern.symbol.includes('Sim'),
      ),
      ...stateMachine(file),
      symbol: primary.name,
    });
  }
  return [...syntheticRoots.values(), ...result].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

function isSubsystemCandidate(
  file: IndexedProjectFile,
  primary: JavaType,
  ownsDirectory: boolean,
): boolean {
  if (
    /(?:Config|Constants|Factory|Calculator|Solution|Params?|Inputs?|Outputs?|Hardware|Util|Utils)$/u.test(
      primary.name,
    )
  ) {
    return false;
  }
  const inheritance = [...primary.extendsTypes, ...primary.implementsTypes].map(simpleJavaType);
  const inheritedSubsystem = inheritance.some((name) =>
    /(?:Subsystem|SubsystemBase|Superstructure|Mechanism|Swerve)$/u.test(name),
  );
  const namedSubsystem = /(?:Subsystem|Superstructure|Mechanism)$/u.test(primary.name);
  const hasMotor = primary.fields.some((field) =>
    /Motor(?:IO|Subsystem)|TalonFX|Spark(?:Max|Flex)/u.test(field.type),
  );
  const hasCommandSurface = file.index.commandMethods.length > 0;
  return ownsDirectory || inheritedSubsystem || namedSubsystem || (hasMotor && hasCommandSurface);
}

function stateMachine(
  file: IndexedProjectFile,
): Pick<Subsystem, 'stateMachine'> | Record<string, never> {
  const declaration = file.index.states.find(
    (state) => (state.role === 'goal' || state.role === 'state') && state.values.length > 0,
  );
  if (declaration === undefined) return {};
  return {
    stateMachine: {
      states: declaration.values.map((value, index) => ({
        actions: [],
        displayName: value,
        id: stableId(`state:${file.path}:${declaration.name}:${value}`),
        initial: index === 0,
        symbol: javaSymbol(value),
      })),
      transitions: [],
    },
  };
}

function simpleJavaType(value: string): string {
  const withoutGenerics = value.replace(/<.*>/su, '').trim();
  return withoutGenerics.split('.').at(-1) ?? withoutGenerics;
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

function inferControllers(
  files: readonly IndexedProjectFile[],
  basePackage: string,
): readonly Controller[] {
  const controllers: Controller[] = [];
  const usedPorts = new Set<number>();
  for (const file of files) {
    if (!isRobotRuntimeSource(file, basePackage)) continue;
    for (const declaration of file.index.controllers) {
      if (controllers.some((entry) => entry.symbol === declaration.fieldName)) continue;
      let port = declaration.port;
      if (port === undefined || usedPorts.has(port)) {
        port = 0;
        while (usedPorts.has(port)) port += 1;
      }
      usedPorts.add(port);
      controllers.push({
        displayName: declaration.fieldName,
        id: stableId(`controller:${file.path}:${declaration.fieldName}`),
        port,
        provider: declaration.controllerType,
        role: /operator|copilot|manipulator/iu.test(declaration.fieldName) ? 'operator' : 'driver',
        symbol: declaration.fieldName,
      });
    }
  }
  return controllers;
}

function inferCommands(
  files: readonly IndexedProjectFile[],
  basePackage: string,
): readonly CommandDefinition[] {
  const factories = files.flatMap((file) => {
    if (!isRobotRuntimeSource(file, basePackage)) return [];
    return file.index.commandMethods.flatMap((method) => {
      if (/^(?:getAutonomousCommand|selectedCommand)$/u.test(method.name)) return [];
      return [
        {
          displayName: `${method.name}${method.parameters}`,
          id: stableId(`command:${file.path}:${method.name}:${method.parameters}`),
          javaFile: file.path,
          kind: 'custom' as const,
          requirementIds: [],
          symbol: method.name,
        },
      ];
    });
  });
  const commandClasses = files.flatMap((file) => {
    if (!isRobotRuntimeSource(file, basePackage)) return [];
    return file.index.types
      .filter(
        (type) =>
          type.kind === 'class' &&
          (type.name.endsWith('Command') ||
            [...type.extendsTypes, ...type.implementsTypes].some((name) =>
              /(?:^|\.)(?:Command|CommandBase)$/u.test(simpleJavaType(name)),
            )),
      )
      .map((type) => ({
        displayName: type.name,
        factory: false,
        id: stableId(`command-class:${file.path}:${type.name}`),
        javaFile: file.path,
        kind: 'custom' as const,
        requirementIds: [],
        symbol: type.name,
      }));
  });
  return [...factories, ...commandClasses];
}

function inferBindings(
  files: readonly IndexedProjectFile[],
  basePackage: string,
  controllerByField: ReadonlyMap<string, Controller>,
  commands: readonly CommandDefinition[],
): readonly ControlBinding[] {
  const commandBySymbol = new Map<string, CommandDefinition>();
  for (const command of commands) {
    if (!commandBySymbol.has(command.symbol)) commandBySymbol.set(command.symbol, command);
  }
  return files.flatMap((file) =>
    !isRobotRuntimeSource(file, basePackage)
      ? []
      : file.index.bindings.flatMap((binding, index) => {
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

function isRobotRuntimeSource(file: IndexedProjectFile, basePackage: string): boolean {
  const packageName = file.index.packageName;
  if (
    packageName === undefined ||
    !(packageName === basePackage || packageName.startsWith(`${basePackage}.`))
  ) {
    return false;
  }
  return !/^src\/(?:test|integrationTest|ext|generated)\//iu.test(file.path);
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
