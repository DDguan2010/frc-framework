import type { FrcProjectModel, Subsystem } from './model.js';

export interface SubsystemJavaLocation {
  readonly className: string;
  readonly file: string;
  readonly packageName: string;
}

/**
 * Resolves the deterministic Java home for every node in the subsystem tree.
 * Explicit paths win; otherwise each child receives a package below its parent.
 */
export function subsystemJavaLocation(
  model: FrcProjectModel,
  subsystemOrId: Subsystem | string,
): SubsystemJavaLocation {
  const subsystem =
    typeof subsystemOrId === 'string'
      ? model.subsystems.find((entry) => entry.id === subsystemOrId)
      : subsystemOrId;
  if (subsystem === undefined) throw new Error(`Subsystem ${subsystemOrId} does not exist.`);
  return resolveLocation(model, subsystem, new Set());
}

/**
 * Resolves the location implied by the node's symbol and parent, ignoring an explicit location on
 * the node itself. An explicit location on an ancestor is still respected so ordinary children of
 * fixed-layout presets (for example Swerve) remain underneath that preset.
 */
export function automaticSubsystemJavaLocation(
  model: FrcProjectModel,
  subsystemOrId: Subsystem | string,
): SubsystemJavaLocation {
  const subsystem =
    typeof subsystemOrId === 'string'
      ? model.subsystems.find((entry) => entry.id === subsystemOrId)
      : subsystemOrId;
  if (subsystem === undefined) throw new Error(`Subsystem ${subsystemOrId} does not exist.`);
  return resolveAutomaticLocation(model, subsystem, new Set());
}

/** True when removing javaFile/javaPackage preserves the node's current effective location. */
export function subsystemUsesAutomaticJavaLocation(
  model: FrcProjectModel,
  subsystemOrId: Subsystem | string,
): boolean {
  const subsystem =
    typeof subsystemOrId === 'string'
      ? model.subsystems.find((entry) => entry.id === subsystemOrId)
      : subsystemOrId;
  if (subsystem === undefined) throw new Error(`Subsystem ${subsystemOrId} does not exist.`);
  const automatic = automaticSubsystemJavaLocation(model, subsystem);
  return (
    (subsystem.javaPackage === undefined || subsystem.javaPackage === automatic.packageName) &&
    (subsystem.javaFile === undefined || normalizePath(subsystem.javaFile) === automatic.file)
  );
}

/**
 * Returns the field name used when the composition root or RobotCommands injects this node.
 * Duplicate class symbols are qualified by their hierarchy so every generated field stays unique.
 */
export function subsystemJavaFieldName(
  model: FrcProjectModel,
  subsystemOrId: Subsystem | string,
): string {
  const subsystem =
    typeof subsystemOrId === 'string'
      ? model.subsystems.find((entry) => entry.id === subsystemOrId)
      : subsystemOrId;
  if (subsystem === undefined) throw new Error(`Subsystem ${subsystemOrId} does not exist.`);
  if (model.subsystems.filter((entry) => entry.symbol === subsystem.symbol).length === 1) {
    return lowerFirst(subsystem.symbol);
  }
  const path: string[] = [subsystem.symbol];
  let cursor = subsystem;
  const visited = new Set<string>([subsystem.id]);
  while (cursor.parentId !== undefined) {
    const parent = model.subsystems.find((entry) => entry.id === cursor.parentId);
    if (parent === undefined || visited.has(parent.id)) break;
    visited.add(parent.id);
    path.unshift(parent.symbol);
    cursor = parent;
  }
  return lowerFirst(path.join(''));
}

export function rootSubsystem(
  model: FrcProjectModel,
  subsystemOrId: Subsystem | string,
): Subsystem {
  let current =
    typeof subsystemOrId === 'string'
      ? model.subsystems.find((entry) => entry.id === subsystemOrId)
      : subsystemOrId;
  if (current === undefined) throw new Error(`Subsystem ${subsystemOrId} does not exist.`);
  const visited = new Set<string>();
  while (current.parentId !== undefined) {
    if (visited.has(current.id)) throw new Error('Subsystem hierarchy contains a cycle.');
    visited.add(current.id);
    const parent = model.subsystems.find((entry) => entry.id === current?.parentId);
    if (parent === undefined)
      throw new Error(`Subsystem parent ${current.parentId} does not exist.`);
    current = parent;
  }
  return current;
}

function resolveLocation(
  model: FrcProjectModel,
  subsystem: Subsystem,
  visited: ReadonlySet<string>,
): SubsystemJavaLocation {
  if (visited.has(subsystem.id)) throw new Error('Subsystem hierarchy contains a cycle.');
  const nextVisited = new Set(visited).add(subsystem.id);
  const explicitPackage = subsystem.javaPackage ?? packageFromJavaFile(subsystem.javaFile);
  let packageName = explicitPackage;
  if (packageName === undefined) {
    if (subsystem.parentId === undefined) {
      packageName = `${model.project.javaPackage}.subsystems.${lowerFirst(subsystem.symbol)}`;
    } else {
      const parent = model.subsystems.find((entry) => entry.id === subsystem.parentId);
      if (parent === undefined)
        throw new Error(`Subsystem parent ${subsystem.parentId} does not exist.`);
      packageName = `${resolveLocation(model, parent, nextVisited).packageName}.${lowerFirst(subsystem.symbol)}`;
    }
  }
  return {
    className: subsystem.symbol,
    file:
      subsystem.javaFile ??
      `src/main/java/${packageName.replace(/\./gu, '/')}/${subsystem.symbol}.java`,
    packageName,
  };
}

function resolveAutomaticLocation(
  model: FrcProjectModel,
  subsystem: Subsystem,
  visited: ReadonlySet<string>,
): SubsystemJavaLocation {
  if (visited.has(subsystem.id)) throw new Error('Subsystem hierarchy contains a cycle.');
  const nextVisited = new Set(visited).add(subsystem.id);
  let packageName: string;
  if (subsystem.parentId === undefined) {
    packageName = `${model.project.javaPackage}.subsystems.${lowerFirst(subsystem.symbol)}`;
  } else {
    const parent = model.subsystems.find((entry) => entry.id === subsystem.parentId);
    if (parent === undefined)
      throw new Error(`Subsystem parent ${subsystem.parentId} does not exist.`);
    packageName = `${resolveLocation(model, parent, nextVisited).packageName}.${lowerFirst(subsystem.symbol)}`;
  }
  return {
    className: subsystem.symbol,
    file: `src/main/java/${packageName.replace(/\./gu, '/')}/${subsystem.symbol}.java`,
    packageName,
  };
}

function packageFromJavaFile(file: string | undefined): string | undefined {
  if (file === undefined) return undefined;
  const normalized = normalizePath(file);
  const match = /^src\/main\/java\/(.+)\/[^/]+\.java$/u.exec(normalized);
  return match?.[1]?.replace(/\//gu, '.');
}

function normalizePath(file: string): string {
  return file.replace(/\\/gu, '/');
}

function lowerFirst(value: string): string {
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
}
