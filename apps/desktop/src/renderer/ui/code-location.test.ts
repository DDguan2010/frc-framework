import { createEmptyProject, createEntityId } from '@frc-framework/domain';
import { describe, expect, it } from 'vitest';

import { autoCodeFile, commandCodeFile } from './code-location.js';

describe('renderer code locations', () => {
  const base = createEmptyProject({
    javaPackage: 'frc.robot',
    name: 'Code Location Robot',
    teamNumber: 10541,
    wpilibYear: 2026,
  });

  it('opens generated Auto logic in RobotCommands', () => {
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

    expect(commandCodeFile(model, command)).toBe(
      'src/main/java/frc/robot/commands/RobotCommands.java',
    );
    expect(autoCodeFile(model, auto)).toBe('src/main/java/frc/robot/commands/RobotCommands.java');
  });

  it('opens handwritten Auto logic in its inferred Java file', () => {
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
  });

  it('falls back to AutoRoutines when an Auto has no command', () => {
    const auto = {
      displayName: 'Unassigned Auto',
      id: createEntityId(),
      pathFiles: [],
      symbol: 'UnassignedAuto',
    };

    expect(autoCodeFile({ ...base, autos: [auto] }, auto)).toBe(
      'src/main/java/frc/robot/auto/AutoRoutines.java',
    );
  });
});
