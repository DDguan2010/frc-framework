import type { AutoRoutine, CommandDefinition, FrcProjectModel } from '@frc-framework/domain';

export interface CodeLocation {
  readonly file: string;
  readonly line: number;
  readonly column?: number;
}

export interface CodeIndexFile {
  readonly path: string;
  readonly symbols?: readonly {
    readonly label: string;
    readonly kind: string;
    readonly line: number;
    readonly column: number;
  }[];
}

/** Resolves the Java file that contains a command's implementation. */
export function commandCodeFile(model: FrcProjectModel, command: CommandDefinition): string {
  const packagePath = model.project.javaPackage.replace(/\./gu, '/');
  return command.javaFile ?? `src/main/java/${packagePath}/commands/RobotCommands.java`;
}

/** Resolves a command to its exact indexed method when source information is available. */
export function commandCodeLocation(
  model: FrcProjectModel,
  command: CommandDefinition,
  sourceFiles: readonly CodeIndexFile[],
): CodeLocation {
  const file = commandCodeFile(model, command);
  const indexed = sourceFiles.find((entry) => normalize(entry.path) === normalize(file));
  const commandSymbols = indexed?.symbols?.filter((entry) => entry.kind === 'command') ?? [];
  const symbol =
    commandSymbols.find((entry) => entry.label === command.displayName) ??
    commandSymbols.find((entry) => entry.label === command.symbol) ??
    commandSymbols.find((entry) => entry.label.startsWith(`${command.symbol}(`));
  return symbol === undefined
    ? { file, line: 1 }
    : { column: symbol.column, file, line: symbol.line };
}

/**
 * Resolves the Java implementation behind an autonomous option. PathPlanner
 * deploy resources are opened separately from the Auto workspace.
 */
export function autoCodeFile(model: FrcProjectModel, auto: AutoRoutine): string {
  const command = model.commands.find((entry) => entry.id === auto.commandId);
  if (command !== undefined) return commandCodeFile(model, command);
  const packagePath = model.project.javaPackage.replace(/\./gu, '/');
  return `src/main/java/${packagePath}/auto/AutoRoutines.java`;
}

export function autoCodeLocation(
  model: FrcProjectModel,
  auto: AutoRoutine,
  sourceFiles: readonly CodeIndexFile[],
): CodeLocation {
  const command = model.commands.find((entry) => entry.id === auto.commandId);
  if (command !== undefined) return commandCodeLocation(model, command, sourceFiles);
  return { file: autoCodeFile(model, auto), line: 1 };
}

function normalize(value: string): string {
  return value.replace(/\\/gu, '/');
}
