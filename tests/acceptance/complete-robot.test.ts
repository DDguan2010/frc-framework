import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createEmptyProject,
  createEntityId,
  validateModel,
  type CommandDefinition,
  type FrcProjectModel,
  type StateMachine,
  type Subsystem,
} from '../../packages/domain/src/index.ts';
import { createProject, generateStructuredFiles } from '../../packages/code-generator/src/index.ts';
import { JavaProjectIndexer } from '../../packages/java-parser/src/index.ts';
import {
  instantiateCommonPreset,
  instantiateLimelightPreset,
  instantiateSwervePreset,
} from '../../packages/presets/src/index.ts';
import { parseProjectYaml } from '../../packages/project-io/src/index.ts';
import {
  collectTuningParameters,
  compareTuningValues,
  createSaveTuningSnapshotCommand,
  createWriteNtValuesCommand,
} from '../../packages/nt-client/src/index.ts';
import { discoverJava, runGradle } from '../../packages/toolchain/src/index.ts';
import { ProjectService } from '../../apps/desktop/src/main/project-service.ts';
import { SettingsStore } from '../../apps/desktop/src/main/settings-store.ts';
import { afterAll, describe, expect, it } from 'vitest';

function goalMachine(names: readonly string[]): StateMachine {
  return {
    states: names.map((name, index) => ({
      actions: [],
      displayName: name,
      id: createEntityId(),
      initial: index === 0,
      symbol: name,
    })),
    transitions: [],
  };
}

function command(
  symbol: string,
  displayName: string,
  requirementIds: readonly string[],
  codeExpression: string,
  pathplannerName?: string,
): CommandDefinition {
  return {
    codeExpression,
    displayName,
    id: createEntityId(),
    kind: 'custom',
    ...(pathplannerName === undefined ? {} : { pathplannerName }),
    requirementIds,
    symbol,
  };
}

function completeRobotModel(): FrcProjectModel {
  const intakeId = createEntityId();
  const shooterId = createEntityId();
  const intake: Subsystem = {
    behaviorMode: 'goal-driven',
    displayName: 'Intake',
    generateGoalCommand: true,
    id: intakeId,
    kind: 'subsystem',
    notes: 'Coordinates the roller and pivot while keeping their hardware independently testable.',
    stateMachine: goalMachine(['Stowed', 'Intaking']),
    symbol: 'Intake',
  };
  const shooter: Subsystem = {
    advantageKitLogging: true,
    behaviorMode: 'goal-driven',
    displayName: 'Shooter',
    generateGoalCommand: true,
    id: shooterId,
    kind: 'subsystem',
    notes: 'Shooter superstructure coordinating two flywheels, hood, and feeder.',
    stateMachine: goalMachine(['Idle', 'Preparing', 'Shooting']),
    symbol: 'Shooter',
  };
  let model = createEmptyProject({
    id: '3b47195c-47d2-4c57-939a-105410000001',
    javaPackage: 'frc.robot.acceptance',
    name: 'FRC Framework Acceptance Robot',
    teamNumber: 10541,
    wpilibYear: 2026,
  });
  model = {
    ...model,
    networkTables: { enabled: true, host: 'localhost', rootPath: '/Tuning' },
    robot: {
      ...model.robot,
      telemetry: { fieldPublisher: true, stateRecorder: true },
    },
    subsystems: [intake, shooter],
  };
  model = instantiateSwervePreset(model, {
    canBus: 'canivore',
    driveIds: [1, 4, 7, 10],
    driveInverted: false,
    driveKP: 0.12,
    driveKV: 0.11,
    driveRatio: 6.75,
    encoderIds: [3, 6, 9, 12],
    encoderOffsets: [0.101, -0.202, 0.303, -0.404],
    gyroId: 13,
    maxSpeed: 4.6,
    pathRotationKP: 5,
    pathTranslationKP: 5,
    statorCurrentLimit: 80,
    steerIds: [2, 5, 8, 11],
    steerKD: 0.01,
    steerKP: 70,
    steerRatio: 21.428,
    supplyCurrentLimit: 40,
    trackwidth: 0.56,
    wheelRadius: 0.0508,
    wheelbase: 0.56,
  });
  model = instantiateLimelightPreset(model, {
    deviceName: 'Front Limelight',
    pipeline: 0,
    streamMode: 0,
    table: 'limelight-front',
    transform: [0.25, 0, 0.55, 0, -18, 0],
  });
  model = instantiateCommonPreset(model, 'frc.velocity-flywheel', {
    canBus: 'canivore',
    canId: 20,
    name: 'IntakeRoller',
    parentId: intakeId,
    setpointUnit: 'rps',
    setpoints: ['IDLE=0', 'INTAKE=45', 'EJECT=-25'],
  });
  model = instantiateCommonPreset(model, 'frc.position-mechanism', {
    canBus: 'canivore',
    canId: 21,
    name: 'IntakePivot',
    parentId: intakeId,
    setpointUnit: 'deg',
    setpoints: ['STOWED=0', 'DEPLOYED=105'],
  });
  model = instantiateCommonPreset(model, 'frc.velocity-flywheel', {
    canBus: 'canivore',
    canId: 22,
    followerIds: [23],
    name: 'UpperFlywheel',
    parentId: shooterId,
    setpointUnit: 'rps',
    setpoints: ['IDLE=0', 'SPEAKER=90', 'AMP=35'],
  });
  model = instantiateCommonPreset(model, 'frc.velocity-flywheel', {
    canBus: 'canivore',
    canId: 24,
    name: 'LowerFlywheel',
    parentId: shooterId,
    setpointUnit: 'rpm',
    setpoints: ['IDLE=0', 'SPEAKER=5100', 'AMP=2100'],
  });
  model = instantiateCommonPreset(model, 'frc.position-mechanism', {
    canBus: 'canivore',
    canId: 25,
    name: 'ShooterHood',
    parentId: shooterId,
    setpointUnit: 'deg',
    setpoints: ['STOWED=5', 'SPEAKER=42', 'AMP=70'],
  });
  model = instantiateCommonPreset(model, 'frc.beambreak-indexer', {
    canBus: 'canivore',
    canId: 26,
    channel: 0,
    name: 'Feeder',
    parentId: shooterId,
  });
  model = instantiateCommonPreset(model, 'frc.led-indicator', {
    channel: 0,
    name: 'StatusLights',
  });

  const bySymbol = (symbol: string) => {
    const node = model.subsystems.find((entry) => entry.symbol === symbol);
    if (node === undefined) throw new Error(`Acceptance fixture is missing ${symbol}.`);
    return node.id;
  };
  const intakeRollerId = bySymbol('IntakeRoller');
  const intakePivotId = bySymbol('IntakePivot');
  const upperId = bySymbol('UpperFlywheel');
  const lowerId = bySymbol('LowerFlywheel');
  const hoodId = bySymbol('ShooterHood');
  const feederId = bySymbol('Feeder');
  const swerveId = bySymbol('SwerveSubsystem');
  model = {
    ...model,
    subsystems: model.subsystems.map((entry) =>
      entry.id === shooterId
        ? {
            ...entry,
            dependencies: [{ fieldName: 'swerve', targetSubsystemId: swerveId }],
          }
        : entry,
    ),
  };

  const commands = [
    command(
      'intakePiece',
      'Intake Piece',
      [intakeId, intakeRollerId, intakePivotId],
      'Commands.parallel(intake.setGoalCommand(Intake.Goal.INTAKING), intakePivot.setGoalCommand(IntakePivot.Goal.DEPLOYED), intakeRoller.setGoalCommand(IntakeRoller.Goal.INTAKE))',
      'Intake Piece',
    ),
    command(
      'stowIntake',
      'Stow Intake',
      [intakeId, intakeRollerId, intakePivotId],
      'Commands.parallel(intake.setGoalCommand(Intake.Goal.STOWED), intakePivot.setGoalCommand(IntakePivot.Goal.STOWED), intakeRoller.setGoalCommand(IntakeRoller.Goal.IDLE))',
      'Stow Intake',
    ),
    command(
      'prepareSpeaker',
      'Prepare Speaker Shot',
      [shooterId, upperId, lowerId, hoodId],
      'Commands.parallel(shooter.setGoalCommand(Shooter.Goal.PREPARING), upperFlywheel.setGoalCommand(UpperFlywheel.Goal.SPEAKER), lowerFlywheel.setGoalCommand(LowerFlywheel.Goal.SPEAKER), shooterHood.setGoalCommand(ShooterHood.Goal.SPEAKER))',
      'Prepare Speaker',
    ),
    command(
      'feedShooter',
      'Feed Shooter',
      [shooterId, feederId],
      'Commands.sequence(shooter.setGoalCommand(Shooter.Goal.SHOOTING), feeder.setGoalCommand(Feeder.Goal.ACTIVE).withTimeout(0.6), feeder.setGoalCommand(Feeder.Goal.IDLE))',
      'Feed Shooter',
    ),
    command(
      'shootSpeaker',
      'Shoot Speaker',
      [shooterId, upperId, lowerId, hoodId, feederId],
      'Commands.sequence(prepareSpeaker(), Commands.waitUntil(() -> upperFlywheel.atGoal() && lowerFlywheel.atGoal() && shooterHood.atGoal()).withTimeout(2.0), feedShooter(), stopShooter())',
      'Shoot Speaker',
    ),
    command(
      'stopShooter',
      'Stop Shooter',
      [shooterId, upperId, lowerId, hoodId, feederId],
      'Commands.parallel(shooter.setGoalCommand(Shooter.Goal.IDLE), upperFlywheel.setGoalCommand(UpperFlywheel.Goal.IDLE), lowerFlywheel.setGoalCommand(LowerFlywheel.Goal.IDLE), shooterHood.setGoalCommand(ShooterHood.Goal.STOWED), feeder.setGoalCommand(Feeder.Goal.IDLE))',
      'Stop Shooter',
    ),
    command(
      'scoreAndLeave',
      'Score And Leave',
      [shooterId, upperId, lowerId, hoodId, feederId],
      'Commands.sequence(shootSpeaker(), Commands.waitSeconds(0.25))',
    ),
  ];
  const driverId = createEntityId();
  const operatorId = createEntityId();
  const commandId = (symbol: string) => commands.find((entry) => entry.symbol === symbol)!.id;
  return {
    ...model,
    autos: [
      {
        commandId: commandId('scoreAndLeave'),
        displayName: 'Score And Leave',
        id: createEntityId(),
        pathFiles: [],
        symbol: 'ScoreAndLeave',
      },
    ],
    bindings: [
      {
        behavior: 'whileTrue',
        commandId: commandId('intakePiece'),
        controllerId: driverId,
        id: createEntityId(),
        input: 'leftTrigger',
      },
      {
        behavior: 'onTrue',
        commandId: commandId('stowIntake'),
        controllerId: driverId,
        id: createEntityId(),
        input: 'leftBumper',
      },
      {
        behavior: 'onTrue',
        commandId: commandId('prepareSpeaker'),
        controllerId: operatorId,
        id: createEntityId(),
        input: 'y',
      },
      {
        behavior: 'onTrue',
        commandId: commandId('shootSpeaker'),
        controllerId: operatorId,
        id: createEntityId(),
        input: 'rightTrigger',
      },
      {
        behavior: 'onTrue',
        commandId: commandId('stopShooter'),
        controllerId: operatorId,
        id: createEntityId(),
        input: 'b',
      },
    ],
    commands,
    controllers: [
      {
        axisScale: 1,
        deadband: 0.08,
        displayName: 'Driver Controller',
        id: driverId,
        port: 0,
        provider: 'CommandXboxController',
        role: 'driver',
        rumbleEnabled: true,
        symbol: 'driver',
      },
      {
        axisScale: 1,
        deadband: 0.08,
        displayName: 'Operator Controller',
        id: operatorId,
        port: 1,
        provider: 'CommandXboxController',
        role: 'operator',
        rumbleEnabled: true,
        symbol: 'operator',
      },
    ],
  };
}

describe.runIf(process.env.FRC_FRAMEWORK_RUN_ACCEPTANCE_ROBOT === '1')(
  'complete generated robot acceptance project',
  () => {
    const temporaryRoots: string[] = [];

    afterAll(async () => {
      await Promise.all(
        temporaryRoots.map((root) =>
          rm(root, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 }),
        ),
      );
    });

    it('creates, compiles, formats, tests, serializes, and re-indexes a realistic robot', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-acceptance-robot-'));
      temporaryRoots.push(root);
      const model = completeRobotModel();
      expect(validateModel(model).filter((problem) => problem.severity === 'error')).toEqual([]);
      await createProject({ model, projectRoot: root });

      const parsed = parseProjectYaml(await readFile(path.join(root, 'project.yaml'), 'utf8'));
      expect(parsed.problems).toEqual([]);
      const yaml = parsed.model;
      expect(yaml).toBeDefined();
      expect(yaml?.subsystems.length).toBe(model.subsystems.length);
      expect(yaml?.devices.length).toBe(model.devices.length);
      expect(yaml?.commands).toHaveLength(7);
      expect(yaml?.bindings).toHaveLength(5);

      const shooterConfig = await readFile(
        path.join(
          root,
          'src/main/java/frc/robot/acceptance/subsystems/shooter/upperFlywheel/UpperFlywheelConfig.java',
        ),
        'utf8',
      );
      expect(shooterConfig).toContain('MotorConfiguration.talonFx("UpperFlywheel Motor", 22)');
      const shooterRuntime = await readFile(
        path.join(root, 'src/main/java/frc/robot/acceptance/subsystems/shooter/Shooter.java'),
        'utf8',
      );
      expect(shooterRuntime).toContain('extends SubsystemBase');
      expect(shooterRuntime).toContain('private final SwerveSubsystem swerve;');
      const commandsJava = await readFile(
        path.join(root, 'src/main/java/frc/robot/acceptance/commands/RobotCommands.java'),
        'utf8',
      );
      expect(commandsJava).toContain('Commands.waitUntil');
      expect(commandsJava).toContain('public Command shootSpeaker()');
      const container = await readFile(
        path.join(root, 'src/main/java/frc/robot/acceptance/RobotContainer.java'),
        'utf8',
      );
      expect(container).toContain('swerveSubsystem.setDefaultCommand');
      const controls = await readFile(
        path.join(root, 'src/main/java/frc/robot/acceptance/controls/OperatorInterface.java'),
        'utf8',
      );
      expect(controls).toContain('public double driverForward()');
      expect(controls).toContain('MathUtil.applyDeadband(-driver.getLeftY(), 0.08)');

      const indexer = await JavaProjectIndexer.create();
      const report = await indexer.indexProject(root);
      expect(report.files.some((file) => file.hasSyntaxErrors)).toBe(false);
      expect(report.model.subsystems.some((entry) => entry.symbol.endsWith('Config'))).toBe(false);
    }, 700_000);

    it('survives a complete nested edit, relocation, reopen, and rebuild lifecycle', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-lifecycle-robot-'));
      const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-lifecycle-state-'));
      const model = completeRobotModel();
      const store = new SettingsStore(path.join(stateRoot, 'state.json'));
      await store.load();
      const service = new ProjectService(store, path.resolve('resources/base-template'), {
        validateCreatedProject: false,
      });
      try {
        await createProject({ model, projectRoot: root, validateBuild: false });
        const opened = await service.open(root);
        expect(opened.problems).toEqual([]);
        expect(opened.model?.subsystems.map((entry) => entry.symbol).sort()).toEqual(
          model.subsystems.map((entry) => entry.symbol).sort(),
        );
        expect(opened.model?.devices).toHaveLength(model.devices.length);
        expect(opened.model?.controllers).toHaveLength(model.controllers.length);
        expect(opened.model?.commands.map((entry) => entry.symbol).sort()).toEqual(
          model.commands.map((entry) => entry.symbol).sort(),
        );
        expect(opened.model?.bindings).toHaveLength(model.bindings.length);
        expect(opened.model?.autos).toHaveLength(model.autos.length);
        for (const generatedPath of generateStructuredFiles(model).keys()) {
          expect(opened.model?.unmanagedFiles).not.toContain(generatedPath);
        }
        const intake = requiredSubsystem(model, 'Intake');
        const shooter = requiredSubsystem(model, 'Shooter');
        const pivot = requiredSubsystem(model, 'IntakePivot');
        const helperId = createEntityId();

        await applyCommand(service, {
          collection: 'subsystems',
          entity: {
            displayName: 'Absolute Zero Sensor',
            id: helperId,
            kind: 'mechanism',
            parentId: pivot.id,
            symbol: 'AbsoluteZeroSensor',
          },
          type: 'add',
        });
        const initialHelperPath =
          'src/main/java/frc/robot/acceptance/subsystems/intake/intakePivot/absoluteZeroSensor/AbsoluteZeroSensor.java';
        const helperSource = await readFile(path.join(root, initialHelperPath), 'utf8');
        await writeFile(
          path.join(root, initialHelperPath),
          helperSource
            .replace(
              'package frc.robot.acceptance.subsystems.intake.intakePivot.absoluteZeroSensor;',
              'package frc.robot.acceptance.subsystems.intake.intakePivot.absoluteZeroSensor;\n\nimport java.util.Optional;',
            )
            .replace(
              /\n\}\s*$/u,
              '\n    public Optional<String> teamOwnedDiagnostic() { return Optional.empty(); }\n}\n',
            ),
          'utf8',
        );

        await applyCommand(service, {
          changes: { parentId: shooter.id },
          target: { collection: 'subsystems', id: pivot.id, scope: 'entity' },
          type: 'update',
        });
        const movedHelperPath =
          'src/main/java/frc/robot/acceptance/subsystems/shooter/intakePivot/absoluteZeroSensor/AbsoluteZeroSensor.java';
        expect(await readFile(path.join(root, movedHelperPath), 'utf8')).toContain(
          'teamOwnedDiagnostic()',
        );

        await applyCommand(service, {
          collection: 'subsystems',
          displayName: 'Collector Pivot',
          id: pivot.id,
          symbol: 'CollectorPivot',
          type: 'rename',
        });
        const renamedHelperPath =
          'src/main/java/frc/robot/acceptance/subsystems/shooter/collectorPivot/absoluteZeroSensor/AbsoluteZeroSensor.java';
        const renamedHelper = await readFile(path.join(root, renamedHelperPath), 'utf8');
        expect(renamedHelper).toContain(
          'package frc.robot.acceptance.subsystems.shooter.collectorPivot.absoluteZeroSensor;',
        );
        expect(renamedHelper).toContain('import java.util.Optional;');
        expect(renamedHelper).toContain('teamOwnedDiagnostic()');

        const current = await service.refresh();
        const collectorPivot = current.model?.subsystems.find((entry) => entry.id === pivot.id);
        if (collectorPivot === undefined)
          throw new Error('Collector Pivot disappeared after refresh.');
        const states = collectorPivot.stateMachine?.states ?? [];
        await applyCommand(service, {
          changes: {
            behaviorMode: 'goal-driven',
            stateMachine: {
              states: [
                ...states,
                {
                  actions: [],
                  displayName: 'Service Position',
                  id: createEntityId(),
                  symbol: 'ServicePosition',
                },
              ],
              transitions: collectorPivot.stateMachine?.transitions ?? [],
            },
          },
          target: { collection: 'subsystems', id: pivot.id, scope: 'entity' },
          type: 'update',
        });
        const collectorPath =
          'src/main/java/frc/robot/acceptance/subsystems/shooter/collectorPivot/CollectorPivot.java';
        expect(await readFile(path.join(root, collectorPath), 'utf8')).toContain(
          'SERVICE_POSITION',
        );

        await applyCommand(service, {
          changes: {
            stateMachine: {
              states,
              transitions: collectorPivot.stateMachine?.transitions ?? [],
            },
          },
          target: { collection: 'subsystems', id: pivot.id, scope: 'entity' },
          type: 'update',
        });
        expect(await readFile(path.join(root, collectorPath), 'utf8')).not.toContain(
          'SERVICE_POSITION',
        );

        await applyCommand(service, {
          changes: { parentId: intake.id },
          target: { collection: 'subsystems', id: pivot.id, scope: 'entity' },
          type: 'update',
        });
        const finalCollectorPath =
          'src/main/java/frc/robot/acceptance/subsystems/intake/collectorPivot/CollectorPivot.java';
        const finalHelperPath =
          'src/main/java/frc/robot/acceptance/subsystems/intake/collectorPivot/absoluteZeroSensor/AbsoluteZeroSensor.java';
        expect(await readFile(path.join(root, finalCollectorPath), 'utf8')).toContain(
          'public final class CollectorPivot',
        );
        expect(await readFile(path.join(root, finalHelperPath), 'utf8')).toContain(
          'teamOwnedDiagnostic()',
        );

        await service.close();
        const reopened = await service.open(root);
        expect(reopened.problems).toEqual([]);
        expect(reopened.model?.subsystems.find((entry) => entry.id === pivot.id)).toMatchObject({
          displayName: 'Collector Pivot',
          parentId: intake.id,
          symbol: 'CollectorPivot',
        });
        const allIds = modelEntityIds(reopened.model);
        expect(new Set(allIds).size).toBe(allIds.length);

        const reopenedModel = reopened.model;
        if (reopenedModel === undefined) throw new Error('Lifecycle model disappeared on reopen.');
        const declarations = collectTuningParameters(reopenedModel);
        expect(declarations.length).toBeGreaterThan(20);
        const gain = declarations.find(
          (entry) => entry.key === 'kP' && entry.deviceName === 'UpperFlywheel Motor',
        );
        if (gain === undefined) throw new Error('Upper flywheel kP is not exposed to NT tuning.');
        expect(gain.writable).toBe(true);
        const tunedValue = Number(gain.codeValue) + 0.031;
        const comparisons = compareTuningValues(
          declarations,
          new Map([
            [gain.path, { type: 'double' as const, updatedAtMillis: 9_500, value: tunedValue }],
          ]),
          { nowMillis: 10_000 },
        );
        await applyCommand(
          service,
          createWriteNtValuesCommand(
            reopenedModel,
            comparisons,
            new Set([gain.parameterId]),
            new Date('2026-07-20T00:00:00Z'),
          ),
        );
        const afterTuning = await service.refresh();
        expect(
          afterTuning.model?.devices
            .flatMap((device) => device.parameters)
            .find((parameter) => parameter.id === gain.parameterId),
        ).toMatchObject({ source: 'networktables', value: tunedValue });
        expect(afterTuning.model?.tuningHistory.at(-1)?.changes).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ parameterId: gain.parameterId, newValue: tunedValue }),
          ]),
        );
        const tuningJava = await readFile(
          path.join(root, 'src/main/java/frc/robot/acceptance/tuning/TuningParameters.java'),
          'utf8',
        );
        expect(tuningJava).toContain(String(tunedValue));

        if (afterTuning.model === undefined) throw new Error('Tuned model disappeared.');
        await applyCommand(
          service,
          createSaveTuningSnapshotCommand(
            afterTuning.model,
            'Lifecycle verified',
            comparisons,
            new Date('2026-07-20T00:01:00Z'),
          ),
        );
        expect((await service.refresh()).model?.tuningSnapshots.at(-1)?.name).toBe(
          'Lifecycle verified',
        );

        await applyCommand(service, {
          collection: 'subsystems',
          id: helperId,
          type: 'remove',
        });
        await expect(readFile(path.join(root, finalHelperPath), 'utf8')).rejects.toMatchObject({
          code: 'ENOENT',
        });
        await service.close();

        const toolchain = await discoverJava({ projectYear: model.project.wpilibYear });
        expect(toolchain.selected).toBeDefined();
        const build = await runGradle({
          java: toolchain.selected,
          projectRoot: root,
          tasks: ['spotlessApply', 'compileJava', 'test'],
          timeoutMs: 600_000,
        });
        expect(build.success, `${build.stdout}\n${build.stderr}`).toBe(true);

        const indexer = await JavaProjectIndexer.create();
        const report = await indexer.indexProject(root);
        expect(report.files.some((file) => file.hasSyntaxErrors)).toBe(false);
        expect(report.model.subsystems.some((entry) => entry.symbol.endsWith('Config'))).toBe(
          false,
        );
      } finally {
        await service.close();
        await rm(root, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
        await rm(stateRoot, { force: true, maxRetries: 5, recursive: true, retryDelay: 100 });
      }
    }, 700_000);
  },
);

async function applyCommand(
  service: ProjectService,
  command: Parameters<ProjectService['previewCommand']>[0],
): Promise<void> {
  const preview = await service.previewCommand(command);
  expect(preview.problems).toEqual([]);
  await service.applyPreview(preview.id);
}

function requiredSubsystem(model: FrcProjectModel, symbol: string): Subsystem {
  const subsystem = model.subsystems.find((entry) => entry.symbol === symbol);
  if (subsystem === undefined) throw new Error(`Acceptance fixture is missing ${symbol}.`);
  return subsystem;
}

function modelEntityIds(model: FrcProjectModel | undefined): readonly string[] {
  if (model === undefined) return [];
  return [
    model.project.id,
    model.robot.id,
    ...model.subsystems.flatMap((subsystem) => [
      subsystem.id,
      ...(subsystem.stateMachine?.states.map((state) => state.id) ?? []),
      ...(subsystem.stateMachine?.transitions.map((transition) => transition.id) ?? []),
    ]),
    ...model.devices.flatMap((device) => [
      device.id,
      ...device.parameters.map((parameter) => parameter.id),
    ]),
    ...model.controllers.map((controller) => controller.id),
    ...model.commands.map((command) => command.id),
    ...model.bindings.map((binding) => binding.id),
    ...model.autos.map((auto) => auto.id),
    ...model.presets.map((preset) => preset.id),
  ];
}
