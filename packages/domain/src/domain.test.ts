import { describe, expect, it } from 'vitest';

import { DomainSession } from './history.js';
import { planSubsystemRemoval, removeSubsystemState } from './deletion.js';
import {
  automaticSubsystemJavaLocation,
  subsystemJavaLocation,
  subsystemUsesAutomaticJavaLocation,
} from './java-location.js';
import { createEmptyProject, createEntityId, PRODUCT_NAME, type Subsystem } from './model.js';
import { validateModel } from './validation.js';

function fixture() {
  return createEmptyProject({
    javaPackage: 'frc.robot',
    name: 'Test Robot',
    teamNumber: 10541,
    wpilibYear: 2026,
  });
}

describe('domain model', () => {
  it('removes goals while repairing the initial state and transitions', () => {
    const idleId = createEntityId();
    const activeId = createEntityId();
    const subsystem: Subsystem = {
      displayName: 'Intake Pivot',
      id: createEntityId(),
      kind: 'mechanism',
      stateMachine: {
        states: [
          { actions: [], displayName: 'Idle', id: idleId, initial: true, symbol: 'Idle' },
          { actions: [], displayName: 'Active', id: activeId, symbol: 'Active' },
        ],
        transitions: [
          {
            fromStateId: idleId,
            id: createEntityId(),
            toStateId: activeId,
            trigger: 'enabled',
          },
        ],
      },
      symbol: 'IntakePivot',
    };

    const removed = removeSubsystemState(subsystem, idleId);
    expect(removed.stateMachine?.states).toEqual([
      expect.objectContaining({ id: activeId, initial: true }),
    ]);
    expect(removed.stateMachine?.transitions).toEqual([]);
    expect(() => removeSubsystemState(removed, idleId)).toThrow('does not exist');
  });

  it('creates a valid project with stable UUID identities', () => {
    const model = fixture();
    expect(PRODUCT_NAME).toBe('FRC Framework');
    expect(model.project.id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(validateModel(model)).toEqual([]);
  });

  it('resolves Java files recursively and rejects parent/dependency constructor cycles', () => {
    const base = fixture();
    const rootId = createEntityId();
    const childId = createEntityId();
    const grandchildId = createEntityId();
    const nested = {
      ...base,
      subsystems: [
        { displayName: 'Intake', id: rootId, kind: 'subsystem' as const, symbol: 'Intake' },
        {
          displayName: 'Pivot',
          id: childId,
          kind: 'mechanism' as const,
          parentId: rootId,
          symbol: 'Pivot',
        },
        {
          displayName: 'Sensor Logic',
          id: grandchildId,
          kind: 'group' as const,
          parentId: childId,
          symbol: 'SensorLogic',
        },
      ],
    };
    expect(subsystemJavaLocation(nested, grandchildId)).toEqual({
      className: 'SensorLogic',
      file: 'src/main/java/frc/robot/subsystems/intake/pivot/sensorLogic/SensorLogic.java',
      packageName: 'frc.robot.subsystems.intake.pivot.sensorLogic',
    });
    expect(validateModel(nested).filter((problem) => problem.severity === 'error')).toEqual([]);
    const cyclic = {
      ...nested,
      subsystems: nested.subsystems.map((entry) =>
        entry.id === childId
          ? {
              ...entry,
              dependencies: [{ fieldName: 'intake', targetSubsystemId: rootId }],
            }
          : entry,
      ),
    };
    expect(validateModel(cyclic)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'composition-cycle' })]),
    );
  });

  it('keeps automatic Java locations synchronized across rename, reparent, and undo', () => {
    const base = fixture();
    const intakeId = createEntityId();
    const shooterId = createEntityId();
    const pivotId = createEntityId();
    const original = {
      ...base,
      subsystems: [
        {
          displayName: 'Intake',
          id: intakeId,
          javaFile: 'src/main/java/frc/robot/subsystems/intake/Intake.java',
          javaPackage: 'frc.robot.subsystems.intake',
          kind: 'subsystem' as const,
          symbol: 'Intake',
        },
        {
          displayName: 'Pivot',
          id: pivotId,
          javaFile: 'src/main/java/frc/robot/subsystems/intake/pivot/Pivot.java',
          javaPackage: 'frc.robot.subsystems.intake.pivot',
          kind: 'mechanism' as const,
          parentId: intakeId,
          symbol: 'Pivot',
        },
        {
          displayName: 'Shooter',
          id: shooterId,
          kind: 'subsystem' as const,
          symbol: 'Shooter',
        },
      ],
    };
    expect(subsystemUsesAutomaticJavaLocation(original, intakeId)).toBe(true);
    expect(automaticSubsystemJavaLocation(original, pivotId).file).toBe(
      'src/main/java/frc/robot/subsystems/intake/pivot/Pivot.java',
    );

    const session = new DomainSession(original);
    const moved = session.execute({
      changes: { parentId: shooterId },
      target: { collection: 'subsystems', id: pivotId, scope: 'entity' },
      type: 'update',
    });
    expect(subsystemJavaLocation(moved.model, pivotId).file).toBe(
      'src/main/java/frc/robot/subsystems/shooter/pivot/Pivot.java',
    );
    expect(moved.model.subsystems.find((entry) => entry.id === pivotId)).not.toHaveProperty(
      'javaFile',
    );

    const renamed = session.execute({
      collection: 'subsystems',
      id: shooterId,
      symbol: 'Launcher',
      type: 'rename',
    });
    expect(subsystemJavaLocation(renamed.model, pivotId).file).toBe(
      'src/main/java/frc/robot/subsystems/launcher/pivot/Pivot.java',
    );
    expect(renamed.touchedEntityIds).toEqual(expect.arrayContaining([shooterId, pivotId]));

    session.undo();
    session.undo();
    expect(session.model.subsystems).toEqual(original.subsystems);
  });

  it('preserves explicit preset locations that do not match the automatic hierarchy', () => {
    const base = fixture();
    const swerve: Subsystem = {
      displayName: 'Swerve',
      id: createEntityId(),
      javaFile: 'src/main/java/frc/robot/subsystems/swerve/SwerveSubsystem.java',
      javaPackage: 'frc.robot.subsystems.swerve',
      kind: 'subsystem',
      symbol: 'SwerveSubsystem',
    };
    const model = { ...base, subsystems: [swerve] };
    expect(subsystemUsesAutomaticJavaLocation(model, swerve)).toBe(false);
    expect(subsystemJavaLocation(model, swerve).file).toBe(swerve.javaFile);
  });

  it('executes typed commands and keeps YAML/code impact metadata', () => {
    const session = new DomainSession(fixture());
    const shooter: Subsystem = {
      displayName: 'Shooter',
      id: createEntityId(),
      kind: 'subsystem',
      symbol: 'Shooter',
    };
    const added = session.execute({ collection: 'subsystems', entity: shooter, type: 'add' });
    expect(added.touchedEntityIds).toEqual([shooter.id]);
    expect(added.outputFiles).toContain('project.yaml');
    expect(session.isClean).toBe(false);

    session.executeMerged('Rename shooter', [
      { collection: 'subsystems', displayName: 'Main Shooter', id: shooter.id, type: 'rename' },
      {
        changes: { notes: 'Upper and lower flywheels' },
        target: { collection: 'subsystems', id: shooter.id, scope: 'entity' },
        type: 'update',
      },
    ]);
    expect(session.model.subsystems[0]?.displayName).toBe('Main Shooter');
    session.undo();
    expect(session.model.subsystems[0]?.displayName).toBe('Shooter');
    session.undo();
    expect(session.model.subsystems).toHaveLength(0);
    session.redo();
    expect(session.model.subsystems).toHaveLength(1);
  });

  it('plans a valid cascading subsystem hierarchy removal', () => {
    const base = fixture();
    const rootId = createEntityId();
    const childId = createEntityId();
    const deviceId = createEntityId();
    const commandId = createEntityId();
    const bindingId = createEntityId();
    const autoId = createEntityId();
    const survivorId = createEntityId();
    const controllerId = createEntityId();
    const model = {
      ...base,
      autos: [
        {
          commandId,
          displayName: 'Score auto',
          id: autoId,
          pathFiles: [],
          symbol: 'ScoreAuto',
        },
      ],
      bindings: [
        {
          behavior: 'onTrue' as const,
          commandId,
          controllerId,
          id: bindingId,
          input: 'a',
        },
      ],
      commands: [
        {
          displayName: 'Move arm',
          id: commandId,
          kind: 'run' as const,
          requirementIds: [rootId],
          symbol: 'moveArm',
        },
      ],
      controllers: [
        {
          displayName: 'Driver',
          id: controllerId,
          port: 0,
          provider: 'CommandXboxController',
          role: 'driver' as const,
          symbol: 'driver',
        },
      ],
      devices: [
        {
          displayName: 'Arm motor',
          id: deviceId,
          kind: 'motor' as const,
          model: 'TalonFX',
          parameters: [],
          parentId: childId,
          symbol: 'armMotor',
          vendor: 'CTRE',
        },
      ],
      subsystems: [
        { displayName: 'Arm', id: rootId, kind: 'subsystem' as const, symbol: 'Arm' },
        {
          displayName: 'Pivot',
          id: childId,
          kind: 'mechanism' as const,
          parentId: rootId,
          symbol: 'Pivot',
        },
        {
          dependencies: [{ fieldName: 'arm', targetSubsystemId: rootId }],
          displayName: 'Survivor',
          id: survivorId,
          kind: 'subsystem' as const,
          stateMachine: {
            states: [
              {
                actions: [{ commandId, targetId: deviceId }],
                displayName: 'Idle',
                id: createEntityId(),
                initial: true,
                symbol: 'Idle',
              },
            ],
            transitions: [],
          },
          symbol: 'Survivor',
        },
      ],
    };

    const plan = planSubsystemRemoval(model, rootId);
    expect(plan.removedSubsystemIds).toEqual(expect.arrayContaining([rootId, childId]));
    expect(plan.removedDeviceIds).toContain(deviceId);
    expect(plan.removedCommandIds).toContain(commandId);
    expect(plan.removedBindingIds).toContain(bindingId);
    expect(plan.removedAutoIds).toContain(autoId);
    expect(plan.model.subsystems).toHaveLength(1);
    expect(plan.model.subsystems[0]?.dependencies).toEqual([]);
    expect(plan.model.subsystems[0]?.stateMachine?.states[0]?.actions).toEqual([]);
    expect(validateModel(plan.model).filter((problem) => problem.severity === 'error')).toEqual([]);

    const session = new DomainSession(model);
    const removed = session.execute({ collection: 'subsystems', id: rootId, type: 'remove' });
    expect(removed.model).toEqual(plan.model);
    expect(removed.touchedEntityIds).toEqual(expect.arrayContaining([rootId, childId, deviceId]));
    session.undo();
    expect(session.model).toEqual(model);
  });

  it('reports duplicate CAN addresses and broken references with entity paths', () => {
    const model = fixture();
    const parent = createEntityId();
    const first = createEntityId();
    const second = createEntityId();
    const invalid = {
      ...model,
      devices: [
        {
          canId: 22,
          displayName: 'Upper',
          id: first,
          kind: 'motor' as const,
          model: 'TalonFX',
          parameters: [],
          parentId: parent,
          symbol: 'upperMotor',
          vendor: 'CTRE',
        },
        {
          canId: 22,
          displayName: 'Lower',
          id: second,
          kind: 'motor' as const,
          model: 'TalonFX',
          parameters: [],
          parentId: parent,
          symbol: 'lowerMotor',
          vendor: 'CTRE',
        },
      ],
      subsystems: [
        { displayName: 'Shooter', id: parent, kind: 'subsystem' as const, symbol: 'Shooter' },
      ],
    };
    expect(validateModel(invalid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate-can-id', entityId: second }),
      ]),
    );
  });

  it('detects cross-subsystem dependency cycles', () => {
    const model = fixture();
    const intakeId = createEntityId();
    const shooterId = createEntityId();
    const invalid = {
      ...model,
      subsystems: [
        {
          dependencies: [{ fieldName: 'shooter', targetSubsystemId: shooterId }],
          displayName: 'Intake',
          id: intakeId,
          kind: 'subsystem' as const,
          symbol: 'Intake',
        },
        {
          dependencies: [{ fieldName: 'intake', targetSubsystemId: intakeId }],
          displayName: 'Shooter',
          id: shooterId,
          kind: 'subsystem' as const,
          symbol: 'Shooter',
        },
      ],
    };
    expect(validateModel(invalid).map((problem) => problem.code)).toContain('dependency-cycle');
  });

  it('validates PathPlanner names and autonomous routine references', () => {
    const model = fixture();
    const commandId = createEntityId();
    const invalid = {
      ...model,
      autos: [
        {
          commandId: createEntityId(),
          displayName: 'Center Auto',
          id: createEntityId(),
          pathFiles: ['../outside.path'],
          symbol: 'centerAuto',
        },
      ],
      commands: [
        {
          displayName: 'Shoot',
          id: commandId,
          kind: 'instant' as const,
          pathplannerName: 'Shoot',
          requirementIds: [],
          symbol: 'shoot',
        },
        {
          displayName: 'Shoot Again',
          id: createEntityId(),
          kind: 'instant' as const,
          pathplannerName: 'Shoot',
          requirementIds: [],
          symbol: 'shootAgain',
        },
      ],
    };
    expect(validateModel(invalid).map((problem) => problem.code)).toEqual(
      expect.arrayContaining([
        'duplicate-named-command',
        'missing-auto-command',
        'invalid-auto-path',
      ]),
    );
  });

  it('warns about controller requirement contention and blocks reused command instances', () => {
    const model = fixture();
    const subsystemId = createEntityId();
    const controllerId = createEntityId();
    const firstCommandId = createEntityId();
    const secondCommandId = createEntityId();
    const instanceId = createEntityId();
    const invalid = {
      ...model,
      bindings: [firstCommandId, secondCommandId].map((commandId, index) => ({
        behavior: index === 0 ? ('onTrue' as const) : ('whileTrue' as const),
        commandId,
        controllerId,
        id: createEntityId(),
        input: 'a',
      })),
      commands: [
        ...[firstCommandId, secondCommandId].map((id, index) => ({
          childCommandIds: [instanceId],
          displayName: `Command ${String(index)}`,
          id,
          kind: 'sequence' as const,
          requirementIds: [subsystemId],
          symbol: `command${String(index)}`,
        })),
        {
          displayName: 'Shared Instance',
          factory: false,
          id: instanceId,
          kind: 'instant' as const,
          requirementIds: [],
          symbol: 'sharedInstance',
        },
      ],
      controllers: [
        {
          displayName: 'Driver',
          id: controllerId,
          port: 0,
          provider: 'CommandXboxController',
          role: 'driver' as const,
          symbol: 'driver',
        },
      ],
      subsystems: [
        { displayName: 'Shooter', id: subsystemId, kind: 'subsystem' as const, symbol: 'Shooter' },
      ],
    };
    const problems = validateModel(invalid);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'binding-requirement-conflict', severity: 'warning' }),
        expect.objectContaining({ code: 'reused-command-instance', severity: 'error' }),
      ]),
    );
  });
});
