import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createEmptyProject, createEntityId, subsystemJavaLocation } from '@frc-framework/domain';
import { instantiateCatalogDevice } from '@frc-framework/frc-catalog';
import {
  instantiateCommonPreset,
  instantiateLimelightPreset,
  instantiateSwervePreset,
} from '@frc-framework/presets';
import {
  calculateFileDiff,
  createCandidateOutput,
  parseProjectYaml,
} from '@frc-framework/project-io';
import { runGradle } from '@frc-framework/toolchain';
import { describe, expect, it } from 'vitest';

import { generateProject, renderText, templateContext } from './generator.js';
import { createProject } from './project-creator.js';

function projectModel() {
  const model = createEmptyProject({
    id: 'e936f1cc-40ce-476a-b37f-99303195db93',
    javaPackage: 'frc.robot.alpha',
    name: 'Alpha Robot',
    teamNumber: 10541,
    wpilibYear: 2026,
  });
  return {
    ...model,
    robot: { ...model.robot, id: '27ae89d1-c564-4e36-95b6-c6e965e8af02' },
  };
}

function fixtureId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function singleMotorFixture() {
  const rootId = fixtureId(1);
  const created = instantiateCatalogDevice({
    canBus: 'rio',
    canId: 20,
    componentId: 'ironpulse.talonfx-primary',
    displayName: 'Intake Motor',
    parentId: rootId,
    selectedParameters: ['kP'],
    values: { kP: 0.15 },
  });
  const motor = {
    ...created,
    id: fixtureId(2),
    parameters: created.parameters.map((parameter, index) => ({
      ...parameter,
      id: fixtureId(100 + index),
    })),
  };
  return {
    ...projectModel(),
    devices: [motor],
    subsystems: [
      {
        behaviorMode: 'direct' as const,
        displayName: 'Intake',
        id: rootId,
        kind: 'subsystem' as const,
        symbol: 'Intake',
      },
    ],
  };
}

function shooterFixture() {
  const rootId = fixtureId(10);
  const mechanismId = fixtureId(11);
  const base = singleMotorFixture();
  return {
    ...base,
    devices: base.devices.map((device) => ({ ...device, parentId: mechanismId })),
    subsystems: [
      {
        behaviorMode: 'goal-driven' as const,
        displayName: 'Shooter',
        generateGoalCommand: true,
        id: rootId,
        kind: 'subsystem' as const,
        stateMachine: {
          states: [
            {
              actions: [],
              displayName: 'Idle',
              id: fixtureId(12),
              initial: true,
              symbol: 'Idle',
            },
          ],
          transitions: [],
        },
        symbol: 'Shooter',
      },
      {
        displayName: 'Upper',
        id: mechanismId,
        kind: 'mechanism' as const,
        parentId: rootId,
        symbol: 'Upper',
      },
    ],
  };
}

describe('deterministic project generator', () => {
  it('normalizes template line endings across Windows, macOS, and Linux', () => {
    const context = templateContext(projectModel());
    const lf = 'name={{PROJECT_NAME}}\nteam={{TEAM_NUMBER}}\n';
    const crlf = 'name={{PROJECT_NAME}}\r\nteam={{TEAM_NUMBER}}\r\n';
    const cr = 'name={{PROJECT_NAME}}\rteam={{TEAM_NUMBER}}\r';
    expect(renderText(crlf, context)).toBe(renderText(lf, context));
    expect(renderText(cr, context)).toBe(renderText(lf, context));
  });

  it('keeps the four golden generator fixtures stable', async () => {
    const swerve = instantiateLimelightPreset(
      instantiateSwervePreset(projectModel(), {
        canBus: 'rio',
        driveIds: [1, 2, 3, 4],
        driveRatio: 6.75,
        encoderIds: [9, 10, 11, 12],
        encoderOffsets: [0.1, -0.2, 0.3, -0.4],
        gyroId: 13,
        maxSpeed: 4.5,
        steerIds: [5, 6, 7, 8],
        steerRatio: 21.428,
        trackwidth: 0.55,
        wheelRadius: 0.0508,
        wheelbase: 0.55,
      }),
      { pipeline: 0, table: 'limelight-front', transform: [0.2, 0, 0.5, 0, -12, 0] },
    );
    const fixtures = {
      emptyBase: projectModel(),
      shooter: shooterFixture(),
      singleMotor: singleMotorFixture(),
      swerveLimelight: swerve,
    };
    const digests = Object.fromEntries(
      await Promise.all(
        Object.entries(fixtures).map(async ([name, fixture]) => [
          name,
          mapDigest((await generateProject(fixture)).files),
        ]),
      ),
    );
    expect(digests).toEqual({
      emptyBase: '4ce98601280a168a29997a0bfd1fd74dcd821baf789708d3756cf0d5aad980ba',
      shooter: '79522e9be2e13216020fe09fff2e5ae9993589f52a3799f08d7d079cf899fe0f',
      singleMotor: '9bd62779e518a8104b831802000bf3e2dc845814f7d3a64368776dafa7c6a18d',
      swerveLimelight: '64f6406e65e804188d4faa05f7e43c506cf260d8589ba7e8a307d103dbe81e18',
    });
  });

  it('renders the single Base, docs, schema, and binary wrapper deterministically', async () => {
    const sourceModel = projectModel();
    const first = await generateProject(sourceModel);
    const second = await generateProject(sourceModel);
    expect([...first.files.keys()]).toEqual([...second.files.keys()]);
    expect(mapDigest(first.files)).toBe(mapDigest(second.files));
    expect(mapDigest(first.files)).toBe(
      '4ce98601280a168a29997a0bfd1fd74dcd821baf789708d3756cf0d5aad980ba',
    );
    expect(first.files.get('src/main/java/frc/robot/alpha/RobotContainer.java')).toContain(
      'package frc.robot.alpha;',
    );
    expect(first.files.get('AGENTS.md')).toContain('docs/ROBOT_OVERVIEW.md');
    expect(first.files.get('gradle/wrapper/gradle-wrapper.jar')).toBeInstanceOf(Uint8Array);
    expect(first.files.has('src/main/java/lib/ironpulse/swerve/Swerve.java')).toBe(false);
    expect(first.files.has('src/main/java/lib/ironpulse/limelight/LimelightSubsystem.java')).toBe(
      false,
    );
    expect(first.files.has('src/main/java/lib/ironpulse/subsystem/BeamBreak.java')).toBe(true);
    expect(first.files.has('src/main/java/lib/ironpulse/command/RumbleCommand.java')).toBe(true);
    expect(first.files.get('docs/IRONPULSE.md')).toContain('IronPulse Robotics');
  });

  it('creates only in an empty directory and emits a valid initial project.yaml', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-create-'));
    const created = await createProject({
      model: projectModel(),
      projectRoot: root,
      validateBuild: false,
    });
    expect(created.generated.files.size).toBeGreaterThan(30);
    const yaml = parseProjectYaml(await readFile(path.join(root, 'project.yaml'), 'utf8'));
    expect(yaml.problems).toEqual([]);
    expect(yaml.model?.project.teamNumber).toBe(10541);
    await expect(createProject({ model: projectModel(), projectRoot: root })).rejects.toThrow(
      'empty directory',
    );
  });

  it('does not leave partial files when build validation cannot find a toolchain', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-nonempty-'));
    await writeFile(path.join(root, 'existing.txt'), 'keep', 'utf8');
    await expect(createProject({ model: projectModel(), projectRoot: root })).rejects.toThrow(
      'empty directory',
    );
    expect(await readFile(path.join(root, 'existing.txt'), 'utf8')).toBe('keep');
  });

  it('generates a readable subsystem hierarchy, motor configuration, state goal, and docs', async () => {
    const base = projectModel();
    const shooterId = createEntityId();
    const upperId = createEntityId();
    const motor = instantiateCatalogDevice({
      canBus: 'canivore',
      canId: 22,
      componentId: 'ironpulse.talonfx-primary',
      displayName: 'Upper Flywheel',
      parentId: upperId,
      publishToNetworkTables: ['kP'],
      selectedParameters: ['kP', 'kV'],
      values: { kP: 0.2, kV: 0.12 },
    });
    const position = instantiateCatalogDevice({
      componentId: 'ironpulse.position-mechanism',
      displayName: 'Hood Position',
      parentId: upperId,
      values: { setpoints: ['HOME=0', 'SPEAKER=85'], setpointUnit: 'deg' },
    });
    const model = {
      ...base,
      devices: [motor, position],
      subsystems: [
        {
          advantageKitLogging: true,
          behaviorMode: 'goal-driven' as const,
          displayName: 'Shooter',
          id: shooterId,
          kind: 'subsystem' as const,
          generateGoalCommand: true,
          realImplementation: true,
          simulationImplementation: true,
          stateMachine: {
            states: [
              {
                actions: [],
                displayName: 'Idle',
                id: createEntityId(),
                initial: true,
                symbol: 'Idle',
              },
              {
                actions: [],
                displayName: 'Shoot',
                id: createEntityId(),
                symbol: 'Shoot',
              },
            ],
            transitions: [],
          },
          symbol: 'Shooter',
        },
        {
          displayName: 'Upper',
          id: upperId,
          kind: 'mechanism' as const,
          parentId: shooterId,
          symbol: 'Upper',
        },
      ],
    };
    const generated = await generateProject(model);
    const shooter = generated.files.get(
      'src/main/java/frc/robot/alpha/subsystems/shooter/Shooter.java',
    );
    expect(shooter).toContain('public enum Goal');
    expect(shooter).toContain('@AutoLogOutput(key = "Shooter/Goal")');
    expect(shooter).toContain('public Command setGoalCommand(Goal value)');
    expect(shooter).toContain('public Upper upper()');
    const upper = generated.files.get(
      'src/main/java/frc/robot/alpha/subsystems/shooter/upper/Upper.java',
    );
    const upperConfig = generated.files.get(
      'src/main/java/frc/robot/alpha/subsystems/shooter/upper/UpperConfig.java',
    );
    expect(upper).toContain('extends SubsystemBase');
    expect(upper).toContain('UpperConfig.upperFlywheelConfiguration()');
    expect(upperConfig).toContain('MotorConfiguration.talonFx("Upper Flywheel", 22)');
    expect(upper).toContain('public enum HoodPositionSetpoint');
    expect(upper).toContain('SPEAKER(85.0);');
    expect(upper).toContain('HOOD_POSITION_SETPOINT_UNIT = "deg"');
    expect(upper).toContain('new MotorIOTalonFX(config)');
    expect(generated.files.get('docs/HARDWARE_MAP.md')).toContain('Shooter / Upper');
    expect(generated.files.get('docs/COMPONENT_CATALOG.md')).toContain(
      'lib.ironpulse.io.MotorIOTalonFX',
    );
    expect(generated.files.get('docs/STATE_MODEL.md')).toContain('`Shoot`');
  });

  it('generates executable Java ownership and goals at every nesting depth', async () => {
    const base = projectModel();
    const intakeId = createEntityId();
    const pivotId = createEntityId();
    const sensorGroupId = createEntityId();
    const pivotCommandId = createEntityId();
    const motor = instantiateCatalogDevice({
      canId: 24,
      componentId: 'ironpulse.talonfx-primary',
      displayName: 'Pivot Motor',
      parentId: pivotId,
      selectedParameters: ['kP'],
      values: { kP: 1.2 },
    });
    const stateMachine = (prefix: string) => ({
      states: [
        {
          actions: [],
          displayName: `${prefix} Idle`,
          id: createEntityId(),
          initial: true,
          symbol: `${prefix}Idle`,
        },
        {
          actions: [],
          displayName: `${prefix} Active`,
          id: createEntityId(),
          symbol: `${prefix}Active`,
        },
      ],
      transitions: [],
    });
    const model = {
      ...base,
      commands: [
        {
          codeExpression: 'intakePivot.setGoalCommand(IntakePivot.Goal.PIVOT_ACTIVE)',
          displayName: 'Move intake pivot',
          id: pivotCommandId,
          kind: 'custom' as const,
          requirementIds: [pivotId],
          symbol: 'moveIntakePivot',
        },
      ],
      devices: [motor],
      subsystems: [
        {
          behaviorMode: 'goal-driven' as const,
          displayName: 'Intake',
          id: intakeId,
          kind: 'subsystem' as const,
          stateMachine: stateMachine('Intake'),
          symbol: 'Intake',
        },
        {
          behaviorMode: 'goal-driven' as const,
          displayName: 'Intake Pivot',
          id: pivotId,
          kind: 'mechanism' as const,
          parentId: intakeId,
          stateMachine: stateMachine('Pivot'),
          symbol: 'IntakePivot',
        },
        {
          behaviorMode: 'goal-driven' as const,
          displayName: 'Zero Sensor Logic',
          id: sensorGroupId,
          kind: 'group' as const,
          parentId: pivotId,
          stateMachine: stateMachine('Sensor'),
          symbol: 'ZeroSensorLogic',
        },
      ],
    };
    const generated = await generateProject(model);
    const intakePath = subsystemJavaLocation(model, intakeId).file;
    const pivotPath = subsystemJavaLocation(model, pivotId).file;
    const sensorPath = subsystemJavaLocation(model, sensorGroupId).file;
    expect(intakePath).toBe('src/main/java/frc/robot/alpha/subsystems/intake/Intake.java');
    expect(pivotPath).toBe(
      'src/main/java/frc/robot/alpha/subsystems/intake/intakePivot/IntakePivot.java',
    );
    expect(sensorPath).toBe(
      'src/main/java/frc/robot/alpha/subsystems/intake/intakePivot/zeroSensorLogic/ZeroSensorLogic.java',
    );
    expect(generated.files.get(intakePath)).toContain('public enum Goal');
    expect(generated.files.get(intakePath)).toContain('public Intake(IntakePivot intakePivot)');
    expect(generated.files.get(pivotPath)).toContain('public enum Goal');
    expect(generated.files.get(pivotPath)).toContain(
      'public IntakePivot(ZeroSensorLogic zeroSensorLogic)',
    );
    expect(generated.files.get(pivotPath.replace(/\.java$/u, 'Config.java'))).toContain(
      'MotorConfiguration.talonFx("Pivot Motor", 24)',
    );
    expect(generated.files.get(sensorPath)).toContain('SENSOR_ACTIVE');
    expect(generated.files.get(intakePath)).toContain('return intakePivot.pivotMotor();');
    const container = generated.files.get('src/main/java/frc/robot/alpha/RobotContainer.java');
    expect(String(container).indexOf('new ZeroSensorLogic()')).toBeLessThan(
      String(container).indexOf('new IntakePivot(zeroSensorLogic)'),
    );
    expect(String(container).indexOf('new IntakePivot(zeroSensorLogic)')).toBeLessThan(
      String(container).indexOf('new Intake(intakePivot)'),
    );
    expect(container).toContain('new RobotCommands(intakePivot)');
    const robotCommands = generated.files.get(
      'src/main/java/frc/robot/alpha/commands/RobotCommands.java',
    );
    expect(robotCommands).toContain(
      'import frc.robot.alpha.subsystems.intake.intakePivot.IntakePivot;',
    );
    expect(robotCommands).toContain('private final IntakePivot intakePivot;');
  });

  it('keeps repeated motor names valid in separate nested branches', async () => {
    const base = projectModel();
    const shooterId = createEntityId();
    const upperId = createEntityId();
    const lowerId = createEntityId();
    const upperMotor = instantiateCatalogDevice({
      canId: 21,
      componentId: 'ironpulse.talonfx-primary',
      displayName: 'Roller',
      parentId: upperId,
    });
    const lowerMotor = instantiateCatalogDevice({
      canId: 22,
      componentId: 'ironpulse.talonfx-primary',
      displayName: 'Roller',
      parentId: lowerId,
    });
    const model = {
      ...base,
      devices: [upperMotor, lowerMotor],
      subsystems: [
        { displayName: 'Shooter', id: shooterId, kind: 'subsystem' as const, symbol: 'Shooter' },
        {
          displayName: 'Upper',
          id: upperId,
          kind: 'mechanism' as const,
          parentId: shooterId,
          symbol: 'Upper',
        },
        {
          displayName: 'Lower',
          id: lowerId,
          kind: 'mechanism' as const,
          parentId: shooterId,
          symbol: 'Lower',
        },
      ],
    };
    const generated = await generateProject(model);
    const root = generated.files.get(subsystemJavaLocation(model, shooterId).file);
    const upper = generated.files.get(subsystemJavaLocation(model, upperId).file);
    const lower = generated.files.get(subsystemJavaLocation(model, lowerId).file);
    expect(root).not.toContain('MotorSubsystem roller()');
    expect(upper).toContain('MotorSubsystem roller()');
    expect(lower).toContain('MotorSubsystem roller()');
  });

  it('generates explicit cross-subsystem imports, constructor injection, and composition order', async () => {
    const base = projectModel();
    const intakeId = createEntityId();
    const shooterId = createEntityId();
    const generated = await generateProject({
      ...base,
      subsystems: [
        {
          displayName: 'Intake',
          id: intakeId,
          kind: 'subsystem',
          symbol: 'Intake',
        },
        {
          dependencies: [{ fieldName: 'intake', targetSubsystemId: intakeId }],
          displayName: 'Shooter',
          id: shooterId,
          kind: 'subsystem',
          symbol: 'Shooter',
        },
      ],
    });
    const shooter = generated.files.get(
      'src/main/java/frc/robot/alpha/subsystems/shooter/Shooter.java',
    );
    expect(shooter).toContain('import frc.robot.alpha.subsystems.intake.Intake;');
    expect(shooter).toContain('public Shooter(Intake intake)');
    const container = generated.files.get('src/main/java/frc/robot/alpha/RobotContainer.java');
    expect(container).toContain('new Shooter(intake)');
    expect(String(container).indexOf('new Intake()')).toBeLessThan(
      String(container).indexOf('new Shooter(intake)'),
    );
  });

  it('generates controller bindings and fresh RobotCommands factories', async () => {
    const base = projectModel();
    const shooterId = createEntityId();
    const controllerId = createEntityId();
    const commandId = createEntityId();
    const generated = await generateProject({
      ...base,
      bindings: [
        {
          behavior: 'onTrue',
          commandId,
          controllerId,
          id: createEntityId(),
          input: 'a',
        },
      ],
      commands: [
        {
          codeExpression: 'shooter.setGoalCommand(Shooter.Goal.IDLE)',
          displayName: 'Prepare Shooter',
          id: commandId,
          kind: 'custom',
          requirementIds: [shooterId],
          symbol: 'prepareShooter',
        },
      ],
      controllers: [
        {
          displayName: 'Driver',
          id: controllerId,
          port: 0,
          provider: 'CommandXboxController',
          role: 'driver',
          symbol: 'driver',
        },
      ],
      subsystems: [
        {
          behaviorMode: 'goal-driven',
          displayName: 'Shooter',
          id: shooterId,
          kind: 'subsystem',
          stateMachine: {
            states: [
              {
                actions: [],
                displayName: 'Idle',
                id: createEntityId(),
                initial: true,
                symbol: 'Idle',
              },
            ],
            transitions: [],
          },
          symbol: 'Shooter',
        },
      ],
    });
    expect(
      generated.files.get('src/main/java/frc/robot/alpha/controls/OperatorInterface.java'),
    ).toContain('driver.a().onTrue(commands.prepareShooter())');
    expect(
      generated.files.get('src/main/java/frc/robot/alpha/commands/RobotCommands.java'),
    ).toContain('return shooter.setGoalCommand(Shooter.Goal.IDLE);');
    expect(generated.files.get('src/main/java/frc/robot/alpha/RobotContainer.java')).toContain(
      'new RobotCommands(shooter)',
    );
  });

  it('generates compound triggers, PathPlanner named commands, and auto chooser options', async () => {
    const base = projectModel();
    const controllerId = createEntityId();
    const commandId = createEntityId();
    const generated = await generateProject({
      ...base,
      autos: [
        {
          commandId,
          displayName: 'Center Auto',
          id: createEntityId(),
          pathFiles: ['pathplanner/autos/Center.auto'],
          symbol: 'centerAuto',
        },
      ],
      bindings: [
        {
          behavior: 'onTrue',
          commandId,
          controllerId,
          id: createEntityId(),
          input: 'a & !b | pov:0',
        },
      ],
      commands: [
        {
          displayName: 'Score Piece',
          id: commandId,
          kind: 'instant',
          pathplannerName: 'Score Piece',
          requirementIds: [],
          symbol: 'scorePiece',
        },
      ],
      controllers: [
        {
          displayName: 'Driver',
          id: controllerId,
          port: 0,
          provider: 'CommandXboxController',
          role: 'driver',
          symbol: 'driver',
        },
      ],
    });
    expect(
      generated.files.get('src/main/java/frc/robot/alpha/controls/OperatorInterface.java'),
    ).toContain('driver.a().and(driver.b().negate()).or(driver.pov(0))');
    expect(generated.files.get('src/main/java/frc/robot/alpha/auto/AutoActions.java')).toContain(
      'NamedCommands.registerCommand("Score Piece", commands.scorePiece())',
    );
    expect(generated.files.get('src/main/java/frc/robot/alpha/auto/AutoRoutines.java')).toContain(
      'chooser.addOption("Center Auto", commands.scorePiece())',
    );
  });
});

describe.runIf(process.env.FRC_FRAMEWORK_RUN_BASE_INTEGRATION === '1')(
  'generated Base Gradle integration',
  () => {
    it('formats, compiles, and tests a fresh project with the installed WPILib JDK', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-base-integration-'));
      const logs: string[] = [];
      const result = await createProject({
        model: projectModel(),
        onLog: (event) => logs.push(event.text),
        projectRoot: root,
      });
      expect(result.toolchain?.selected?.major).toBe(17);
      expect(logs.join('')).toContain('BUILD SUCCESSFUL');
      const selected = result.toolchain?.selected;
      if (selected === undefined) {
        throw new Error('Integration test did not select Java.');
      }
      const simulation = await runGradle({
        arguments: ['--dry-run'],
        java: selected,
        projectRoot: root,
        tasks: ['simulateJava'],
      });
      expect(simulation.success).toBe(true);

      const textFiles = new Map(
        [...result.generated.files].filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      );
      const candidate = await createCandidateOutput(root, textFiles);
      const secondDiff = await calculateFileDiff(root, candidate);
      expect(secondDiff.every((change) => change.kind === 'unchanged')).toBe(true);
    }, 700_000);

    it('compiles a generated goal-driven subsystem with a configured TalonFX', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-structured-integration-'));
      const base = projectModel();
      const shooterId = createEntityId();
      const upperId = createEntityId();
      const controllerId = createEntityId();
      const commandId = createEntityId();
      const motor = instantiateCatalogDevice({
        canBus: 'canivore',
        canId: 22,
        componentId: 'ironpulse.talonfx-primary',
        displayName: 'Upper Flywheel',
        parentId: upperId,
        publishToNetworkTables: ['kP', 'motionMagicAcceleration'],
        selectedParameters: [
          'closedLoopRamp',
          'continuousWrap',
          'feedbackSource',
          'forwardSoftLimit',
          'forwardSoftLimitEnabled',
          'gravityType',
          'kP',
          'kV',
          'motionMagicAcceleration',
          'motionMagicJerk',
          'motionMagicVelocity',
          'remoteEncoderEnabled',
          'remoteEncoderCanBus',
          'remoteEncoderId',
          'remoteEncoderMagnetOffset',
          'remoteEncoderSensorDirection',
          'reverseSoftLimit',
          'reverseSoftLimitEnabled',
          'rotorToSensorRatio',
          'simFrictionVoltage',
          'simMaximum',
          'simMinimum',
          'staticFeedforwardSign',
          'tolerance',
          'zeroingCurrent',
          'zeroingFilterSize',
          'zeroingVoltage',
          'zeroOffset',
        ],
        values: {
          closedLoopRamp: 0.1,
          continuousWrap: true,
          feedbackSource: 'fusedCANcoder',
          forwardSoftLimit: 12,
          forwardSoftLimitEnabled: true,
          gravityType: 'armCosine',
          kP: 0.2,
          kV: 0.12,
          motionMagicAcceleration: 20,
          motionMagicJerk: 200,
          motionMagicVelocity: 10,
          remoteEncoderEnabled: true,
          remoteEncoderCanBus: 'canivore',
          remoteEncoderId: 24,
          remoteEncoderMagnetOffset: 0.125,
          remoteEncoderSensorDirection: 'clockwisePositive',
          reverseSoftLimit: -1,
          reverseSoftLimitEnabled: true,
          rotorToSensorRatio: 2,
          simFrictionVoltage: 0.2,
          simMaximum: 12,
          simMinimum: -1,
          staticFeedforwardSign: 'closedLoopSign',
          tolerance: 0.02,
          zeroingCurrent: 35,
          zeroingFilterSize: 7,
          zeroingVoltage: -1.5,
          zeroOffset: 0.25,
        },
      });
      const follower = instantiateCatalogDevice({
        canBus: 'canivore',
        canId: 23,
        componentId: 'ironpulse.talonfx-follower',
        displayName: 'Upper Flywheel Follower',
        parentId: upperId,
        values: { leaderId: motor.id, opposeLeader: true },
      });
      const model = {
        ...base,
        bindings: [
          {
            behavior: 'onTrue' as const,
            commandId,
            controllerId,
            id: createEntityId(),
            input: 'a',
          },
        ],
        commands: [
          {
            codeExpression: 'upper.upperFlywheel().stopCommand()',
            displayName: 'Prepare Shooter',
            id: commandId,
            kind: 'custom' as const,
            requirementIds: [upperId],
            symbol: 'prepareShooter',
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
        devices: [motor, follower],
        subsystems: [
          {
            advantageKitLogging: true,
            behaviorMode: 'goal-driven' as const,
            displayName: 'Shooter',
            id: shooterId,
            kind: 'subsystem' as const,
            generateGoalCommand: true,
            realImplementation: true,
            simulationImplementation: true,
            stateMachine: {
              states: [
                {
                  actions: [],
                  displayName: 'Idle',
                  id: createEntityId(),
                  initial: true,
                  symbol: 'Idle',
                },
              ],
              transitions: [],
            },
            symbol: 'Shooter',
          },
          {
            displayName: 'Upper',
            id: upperId,
            kind: 'mechanism' as const,
            parentId: shooterId,
            symbol: 'Upper',
          },
        ],
      };
      const result = await createProject({ model, projectRoot: root });
      expect(result.toolchain?.selected?.major).toBe(17);
      expect(
        await readFile(
          path.join(root, 'src/main/java/frc/robot/alpha/subsystems/shooter/Shooter.java'),
          'utf8',
        ),
      ).toContain('return upper.upperFlywheel();');
      expect(
        await readFile(
          path.join(root, 'src/main/java/frc/robot/alpha/subsystems/shooter/upper/Upper.java'),
          'utf8',
        ),
      ).toContain('Upper Flywheel');
    }, 700_000);

    it('compiles the complete Swerve and Limelight preset implementations', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-presets-integration-'));
      const withSwerve = instantiateSwervePreset(projectModel(), {
        canBus: 'rio',
        driveIds: [1, 2, 3, 4],
        driveRatio: 6.75,
        encoderIds: [9, 10, 11, 12],
        encoderOffsets: [0.1, -0.2, 0.3, -0.4],
        gyroId: 13,
        maxSpeed: 4.5,
        steerIds: [5, 6, 7, 8],
        steerRatio: 21.428,
        trackwidth: 0.55,
        wheelRadius: 0.0508,
        wheelbase: 0.55,
      });
      const configured = instantiateLimelightPreset(withSwerve, {
        pipeline: 0,
        table: 'limelight-front',
        transform: [0.2, 0, 0.5, 0, -12, 0],
      });
      const result = await createProject({ model: configured, projectRoot: root });
      expect(result.toolchain?.selected?.major).toBe(17);
      expect(
        await readFile(
          path.join(root, 'src/main/java/frc/robot/alpha/subsystems/swerve/SwerveSubsystem.java'),
          'utf8',
        ),
      ).toContain('SwerveDriveOdometry');
      expect(
        await readFile(
          path.join(root, 'src/main/java/frc/robot/alpha/subsystems/swerve/SwerveSubsystem.java'),
          'utf8',
        ),
      ).toContain('AutoBuilder.configure');
      expect(
        await readFile(
          path.join(
            root,
            'src/main/java/frc/robot/alpha/subsystems/vision/LimelightSubsystem.java',
          ),
          'utf8',
        ),
      ).toContain('getEstimatedPoseBlue');
      const container = await readFile(
        path.join(root, 'src/main/java/frc/robot/alpha/RobotContainer.java'),
        'utf8',
      );
      expect(container).toContain('new RobotCalibration(Map.of())');
      expect(container).not.toContain('frontLeftDrive()');
    }, 700_000);

    it('compiles the common motor, sensor, setpoint, and LED presets', async () => {
      const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-common-presets-'));
      const shooterId = createEntityId();
      const base = projectModel();
      let configured = instantiateCommonPreset(
        {
          ...base,
          subsystems: [
            {
              displayName: 'Shooter',
              id: shooterId,
              kind: 'subsystem',
              symbol: 'Shooter',
            },
          ],
        },
        'frc.percent-output',
        {
          canId: 20,
          name: 'Intake',
        },
      );
      configured = instantiateCommonPreset(configured, 'frc.velocity-flywheel', {
        canId: 21,
        followerIds: [22],
        name: 'UpperFlywheel',
        parentId: shooterId,
        setpointUnit: 'rps',
        setpoints: ['IDLE=0', 'SPEAKER=90'],
      });
      configured = instantiateCommonPreset(configured, 'frc.velocity-flywheel', {
        canId: 25,
        name: 'LowerFlywheel',
        parentId: shooterId,
        setpointUnit: 'rpm',
        setpoints: ['IDLE=0', 'SPEAKER=5400'],
      });
      configured = instantiateCommonPreset(configured, 'frc.position-mechanism', {
        canId: 23,
        name: 'Hood',
        setpointUnit: 'deg',
        setpoints: ['HOME=0', 'SPEAKER=42'],
      });
      configured = instantiateCommonPreset(configured, 'frc.beambreak-indexer', {
        canId: 24,
        channel: 0,
        name: 'Indexer',
      });
      configured = instantiateCommonPreset(configured, 'frc.led-indicator', {
        channel: 1,
        name: 'Status',
      });
      const result = await createProject({ model: configured, projectRoot: root });
      expect(result.toolchain?.selected?.major).toBe(17);
      const upperFlywheel = await readFile(
        path.join(
          root,
          'src/main/java/frc/robot/alpha/subsystems/shooter/upperFlywheel/UpperFlywheel.java',
        ),
        'utf8',
      );
      const lowerFlywheel = await readFile(
        path.join(
          root,
          'src/main/java/frc/robot/alpha/subsystems/shooter/lowerFlywheel/LowerFlywheel.java',
        ),
        'utf8',
      );
      expect(upperFlywheel).toContain('velocityCommand(this::goalSetpointRps)');
      expect(upperFlywheel).toContain('public boolean atGoal()');
      expect(lowerFlywheel).toContain('case SPEAKER -> 90.0;');
      expect(
        await readFile(
          path.join(root, 'src/main/java/frc/robot/alpha/subsystems/indexer/Indexer.java'),
          'utf8',
        ),
      ).toContain('!indexerBeamBreakBroken()');
      expect(
        await readFile(
          path.join(root, 'src/main/java/frc/robot/alpha/subsystems/hood/Hood.java'),
          'utf8',
        ),
      ).toContain('zeroAgainstHardStopCommand');
      expect(
        await readFile(
          path.join(root, 'src/main/java/frc/robot/alpha/subsystems/status/Status.java'),
          'utf8',
        ),
      ).toContain('AddressableLED');
    }, 700_000);
  },
);

function mapDigest(files: ReadonlyMap<string, string | Uint8Array>): string {
  const hash = createHash('sha256');
  for (const [filePath, content] of files) {
    hash.update(filePath);
    hash.update(typeof content === 'string' ? content : content);
  }
  return hash.digest('hex');
}
