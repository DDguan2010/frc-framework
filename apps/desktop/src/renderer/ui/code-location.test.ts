import { createEmptyProject, createEntityId } from '@frc-framework/domain';
import { describe, expect, it } from 'vitest';

import {
  autoCodeFile,
  autoCodeLocation,
  commandCodeFile,
  commandCodeLocation,
} from './code-location.js';

describe('renderer code locations', () => {
  const base = createEmptyProject({
    javaPackage: 'frc.robot',
    name: 'Code Location Robot',
    teamNumber: 10541,
    wpilibYear: 2026,
  });

  it('opens generated Auto logic at its RobotCommands method', () => {
    const command = {
      displayName: 'Score And Leave',
      id: createEntityId(),
      kind: 'sequence' as const,
      requirementIds: [],
      symbol: 'scoreAndLeave',
    };
    const auto = {
      commandId: command.id,
      displayName: 'Score And Leave',
      id: createEntityId(),
      pathFiles: [],
      symbol: 'ScoreAndLeave',
    };
    const model = { ...base, autos: [auto], commands: [command] };
    const sourceFiles = [
      {
        path: 'src/main/java/frc/robot/commands/RobotCommands.java',
        symbols: [{ column: 5, kind: 'command', label: 'scoreAndLeave()', line: 42 }],
      },
    ];

    expect(commandCodeFile(model, command)).toBe(
      'src/main/java/frc/robot/commands/RobotCommands.java',
    );
    expect(autoCodeFile(model, auto)).toBe('src/main/java/frc/robot/commands/RobotCommands.java');
    expect(commandCodeLocation(model, command, sourceFiles)).toEqual({
      column: 5,
      file: 'src/main/java/frc/robot/commands/RobotCommands.java',
      line: 42,
    });
    expect(autoCodeLocation(model, auto, sourceFiles)).toEqual({
      column: 5,
      file: 'src/main/java/frc/robot/commands/RobotCommands.java',
      line: 42,
    });
  });

  it('opens handwritten Auto logic at its inferred Java method', () => {
    const javaFile = 'src/main/java/frc/robot/auto/CompetitionAutos.java';
    const command = {
      displayName: 'centerAuto()',
      id: createEntityId(),
      javaFile,
      kind: 'custom' as const,
      requirementIds: [],
      symbol: 'centerAuto',
    };
    const auto = {
      commandId: command.id,
      displayName: 'Center Auto',
      id: createEntityId(),
      pathFiles: ['pathplanner/paths/Center.path'],
      symbol: 'CenterAuto',
    };
    const model = { ...base, autos: [auto], commands: [command] };

    expect(autoCodeFile(model, auto)).toBe(javaFile);
    expect(
      autoCodeLocation(model, auto, [
        {
          path: javaFile.replaceAll('/', '\\'),
          symbols: [{ column: 12, kind: 'command', label: 'centerAuto()', line: 8 }],
        },
      ]),
    ).toEqual({ column: 12, file: javaFile, line: 8 });
  });

  it('falls back safely while no matching command index is available', () => {
    const command = {
      displayName: 'Shoot',
      id: createEntityId(),
      kind: 'custom' as const,
      requirementIds: [],
      symbol: 'shoot',
    };
    const auto = {
      displayName: 'Unassigned Auto',
      id: createEntityId(),
      pathFiles: [],
      symbol: 'UnassignedAuto',
    };

    expect(commandCodeLocation({ ...base, commands: [command] }, command, [])).toEqual({
      file: 'src/main/java/frc/robot/commands/RobotCommands.java',
      line: 1,
    });
    expect(autoCodeLocation({ ...base, autos: [auto] }, auto, [])).toEqual({
      file: 'src/main/java/frc/robot/auto/AutoRoutines.java',
      line: 1,
    });
  });
});
