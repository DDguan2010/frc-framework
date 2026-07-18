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

function packageFromJavaFile(file: string | undefined): string | undefined {
  if (file === undefined) return undefined;
  const normalized = file.replace(/\\/gu, '/');
  const match = /^src\/main\/java\/(.+)\/[^/]+\.java$/u.exec(normalized);
  return match?.[1]?.replace(/\//gu, '.');
}

function lowerFirst(value: string): string {
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
}
