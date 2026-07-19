import type { AutoRoutine, CommandDefinition, FrcProjectModel } from '@frc-framework/domain';

/** Resolves the Java file that contains a command's implementation. */
export function commandCodeFile(model: FrcProjectModel, command: CommandDefinition): string {
  const packagePath = model.project.javaPackage.replace(/\./gu, '/');
  return command.javaFile ?? `src/main/java/${packagePath}/commands/RobotCommands.java`;
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
