import { mkdir, readFile, rm } from 'node:fs/promises';
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
import { createProject } from '../../packages/code-generator/src/index.ts';
import { JavaProjectIndexer } from '../../packages/java-parser/src/index.ts';
import {
  instantiateCommonPreset,
  instantiateLimelightPreset,
  instantiateSwervePreset,
} from '../../packages/presets/src/index.ts';
import { parseProjectYaml } from '../../packages/project-io/src/index.ts';
import { describe, expect, it } from 'vitest';

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
    it('creates, compiles, formats, tests, serializes, and re-indexes a realistic robot', async () => {
      const root = path.resolve('output/acceptance-robot');
      await rm(root, { force: true, recursive: true });
      await mkdir(root, { recursive: true });
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
  },
);
