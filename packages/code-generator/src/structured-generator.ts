import type {
  Device,
  DeviceParameter,
  FrcProjectModel,
  StateDefinition,
  Subsystem,
} from '@frc-framework/domain';
import { rootSubsystem, subsystemJavaLocation } from '@frc-framework/domain';
import { findComponentDefinition, validateHardware } from '@frc-framework/frc-catalog';
import { collectTuningParameters } from '@frc-framework/nt-client';
import { generatePresetFiles } from '@frc-framework/presets';
import type { ProjectFileContent } from '@frc-framework/project-io';

export function generateStructuredFiles(
  model: FrcProjectModel,
): ReadonlyMap<string, ProjectFileContent> {
  const problems = validateHardware(model).filter((problem) => problem.severity === 'error');
  if (problems.length > 0) {
    throw new Error(
      `Hardware model is invalid:\n${problems.map((entry) => `${entry.field}: ${entry.message}`).join('\n')}`,
    );
  }
  const files = new Map<string, ProjectFileContent>();
  for (const subsystem of [...model.subsystems].sort((left, right) =>
    subsystemJavaLocation(model, left).file.localeCompare(subsystemJavaLocation(model, right).file),
  )) {
    const location = subsystemJavaLocation(model, subsystem);
    files.set(location.file, subsystemJava(model, subsystem, location.packageName));
    const motors = ownedMotors(model, subsystem);
    if (motors.length > 0) {
      files.set(
        location.file.replace(/\.java$/u, 'Config.java'),
        subsystemConfigJava(model, subsystem, location.packageName, motors),
      );
    }
  }
  files.set(
    `src/main/java/${model.project.javaPackage.replace(/\./gu, '/')}/RobotContainer.java`,
    robotContainerJava(model),
  );
  files.set(
    `src/main/java/${model.project.javaPackage.replace(/\./gu, '/')}/auto/AutoActions.java`,
    autoActionsJava(model),
  );
  files.set(
    `src/main/java/${model.project.javaPackage.replace(/\./gu, '/')}/auto/AutoRoutines.java`,
    autoRoutinesJava(model),
  );
  files.set(
    `src/main/java/${model.project.javaPackage.replace(/\./gu, '/')}/tuning/TuningParameters.java`,
    tuningParametersJava(model),
  );
  files.set(
    `src/main/java/${model.project.javaPackage.replace(/\./gu, '/')}/controls/OperatorInterface.java`,
    operatorInterfaceJava(model),
  );
  files.set(
    `src/main/java/${model.project.javaPackage.replace(/\./gu, '/')}/commands/RobotCommands.java`,
    robotCommandsJava(model),
  );
  files.set(
    `src/main/java/${model.project.javaPackage.replace(/\./gu, '/')}/telemetry/RobotTelemetry.java`,
    robotTelemetryJava(model),
  );
  files.set(
    `src/main/java/${model.project.javaPackage.replace(/\./gu, '/')}/telemetry/FieldPublisher.java`,
    fieldPublisherJava(model),
  );
  files.set(
    `src/main/java/${model.project.javaPackage.replace(/\./gu, '/')}/telemetry/RobotStateRecorder.java`,
    robotStateRecorderJava(model),
  );
  files.set(
    `src/main/java/${model.project.javaPackage.replace(/\./gu, '/')}/calibration/RobotCalibration.java`,
    robotCalibrationJava(model),
  );
  files.set('docs/HARDWARE_MAP.md', hardwareMapDocument(model));
  files.set('docs/ROBOT_OVERVIEW.md', robotOverviewDocument(model));
  files.set('docs/SUBSYSTEMS.md', subsystemsDocument(model));
  files.set('docs/STATE_MODEL.md', stateModelDocument(model));
  files.set('docs/CONTROL_BINDINGS.md', controlBindingsDocument(model));
  files.set('docs/CODE_STYLE.md', codeStyleDocument());
  files.set('docs/SAFETY.md', safetyDocument(model));
  files.set('docs/TUNING.md', tuningDocument(model));
  files.set('docs/COMPONENT_CATALOG.md', componentCatalogDocument(model));
  files.set('docs/TELEMETRY.md', telemetryDocument(model));
  files.set('docs/CALIBRATION.md', calibrationDocument(model));
  files.set('docs/SIMULATION.md', simulationDocument());
  for (const [filePath, content] of generatePresetFiles(model)) files.set(filePath, content);
  return files;
}

function roots(model: FrcProjectModel): readonly Subsystem[] {
  return model.subsystems
    .filter((entry) => entry.parentId === undefined)
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function descendants(model: FrcProjectModel, rootId: string): readonly Subsystem[] {
  const result: Subsystem[] = [];
  const visit = (parentId: string): void => {
    for (const child of model.subsystems
      .filter((entry) => entry.parentId === parentId)
      .sort((left, right) => left.symbol.localeCompare(right.symbol))) {
      result.push(child);
      visit(child.id);
    }
  };
  visit(rootId);
  return result;
}

function children(model: FrcProjectModel, parentId: string): readonly Subsystem[] {
  return model.subsystems
    .filter((entry) => entry.parentId === parentId)
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function ownedDevices(model: FrcProjectModel, node: Subsystem): readonly Device[] {
  return model.devices.filter(
    (device) => device.parentId === node.id && !presetOwnsDevice(model, node, device),
  );
}

function ownedMotors(model: FrcProjectModel, node: Subsystem): readonly Device[] {
  return ownedDevices(model, node)
    .filter((device) => device.kind === 'motor')
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function subsystemJava(model: FrcProjectModel, node: Subsystem, packageName: string): string {
  const directChildren = children(model, node.id);
  const directDevices = ownedDevices(model, node);
  const motors = ownedMotors(model, node);
  const mechanismConfigurations = directDevices
    .filter(
      (device) =>
        device.catalogId !== undefined &&
        findComponentDefinition(device.catalogId)?.role === 'mechanism',
    )
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
  const controlledMechanism = mechanismConfigurations.find((device) =>
    ['ironpulse.velocity-mechanism', 'ironpulse.position-mechanism'].includes(
      device.catalogId ?? '',
    ),
  );
  const controlledMotor =
    motors.find((device) => device.role === 'primary') ??
    motors.find((device) => device.role !== 'follower');
  const beamBreaks = directDevices
    .filter((device) => device.catalogId === 'ironpulse.beam-break')
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
  const indicators = directDevices
    .filter((device) => device.catalogId === 'ironpulse.indicator')
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
  const stateMachine = node.stateMachine;
  const dependencies = (node.dependencies ?? [])
    .map((dependency) => ({
      ...dependency,
      target: model.subsystems.find((entry) => entry.id === dependency.targetSubsystemId),
    }))
    .filter((entry): entry is typeof entry & { target: Subsystem } => entry.target !== undefined)
    .sort((left, right) => left.fieldName.localeCompare(right.fieldName));
  const needsCommands = stateMachine !== undefined && stateMachine.states.length > 0;
  const hasDelegatedMotors = model.devices.some((device) => {
    const owner = model.subsystems.find((entry) => entry.id === device.parentId);
    return (
      device.kind === 'motor' &&
      owner !== undefined &&
      descendants(model, node.id).some((entry) => entry.id === owner.id) &&
      !presetOwnsDevice(model, owner, device)
    );
  });
  const hasTuning = directDevices.some((device) =>
    device.parameters.some((parameter) => parameter.networkTables?.enabled === true),
  );
  const imports = [
    ...(motors.length === 0 ? [] : ['edu.wpi.first.wpilibj.RobotBase']),
    ...(beamBreaks.length === 0
      ? []
      : ['edu.wpi.first.wpilibj.AnalogInput', 'edu.wpi.first.wpilibj.DigitalInput']),
    ...(indicators.length === 0
      ? []
      : ['edu.wpi.first.wpilibj.AddressableLED', 'edu.wpi.first.wpilibj.AddressableLEDBuffer']),
    ...(needsCommands ? ['edu.wpi.first.wpilibj2.command.Command'] : []),
    'edu.wpi.first.wpilibj2.command.SubsystemBase',
    ...(needsCommands && node.advantageKitLogging === true
      ? ['org.littletonrobotics.junction.AutoLogOutput']
      : []),
    ...(motors.length === 0
      ? []
      : [
          'lib.ironpulse.io.MotorIO',
          'lib.ironpulse.io.MotorIOSim',
          'lib.ironpulse.io.MotorIOTalonFX',
          'lib.ironpulse.subsystem.MotorConfiguration',
          'lib.ironpulse.subsystem.MotorSubsystem',
        ]),
    ...(motors.length === 0 && hasDelegatedMotors
      ? ['lib.ironpulse.subsystem.MotorSubsystem']
      : []),
    ...(hasTuning ? [`${model.project.javaPackage}.tuning.TuningParameters`] : []),
    ...directChildren.map((child) => {
      const location = subsystemJavaLocation(model, child);
      return location.packageName === packageName ? '' : `${location.packageName}.${child.symbol}`;
    }),
    ...dependencies.map((dependency) => {
      const location = subsystemJavaLocation(model, dependency.target);
      return location.packageName === packageName
        ? ''
        : `${location.packageName}.${dependency.target.symbol}`;
    }),
  ];
  const lines: string[] = [
    `package ${packageName};`,
    '',
    ...[...new Set(imports.filter((entry) => entry.length > 0))]
      .sort()
      .map((entry) => `import ${entry};`),
    '',
    `/** ${escapeJavadoc(node.notes ?? `${node.displayName} ${node.kind}.`)}${motors.length === 0 ? '' : ` Runtime goals and commands live here; hardware values live in ${node.symbol}Config.`} */`,
    `public final class ${node.symbol} extends SubsystemBase {`,
    '    // <frc-framework:managed>',
  ];
  for (const child of directChildren) {
    lines.push(`    private final ${child.symbol} ${lowerFirst(child.symbol)};`);
  }
  for (const dependency of dependencies) {
    lines.push(`    private final ${dependency.target.symbol} ${dependency.fieldName};`);
  }
  for (const motor of motors) lines.push(...motorFieldDeclaration(node, motor));
  for (const mechanism of mechanismConfigurations)
    lines.push(...mechanismSetpointDeclaration(mechanism));
  for (const sensor of beamBreaks) lines.push(...beamBreakDeclaration(sensor));
  for (const indicator of indicators) lines.push(...indicatorDeclaration(indicator));
  const constructorParameters = [
    ...directChildren.map((child) => `${child.symbol} ${lowerFirst(child.symbol)}`),
    ...dependencies.map((dependency) => `${dependency.target.symbol} ${dependency.fieldName}`),
  ];
  const defaultControl =
    controlledMechanism === undefined && beamBreaks.length > 0 && controlledMotor !== undefined
      ? [
          `${lowerFirst(controlledMotor.symbol)}.setDefaultCommand(${lowerFirst(controlledMotor.symbol)}.runDutyCycle(this::goalDutyCycle));`,
        ]
      : mechanismDefaultControl(controlledMechanism, controlledMotor);
  if (constructorParameters.length > 0 || defaultControl.length > 0) {
    lines.push(
      '',
      `    public ${node.symbol}(${constructorParameters.join(', ')}) {`,
      ...directChildren.map(
        (child) => `        this.${lowerFirst(child.symbol)} = ${lowerFirst(child.symbol)};`,
      ),
      ...dependencies.map(
        (dependency) => `        this.${dependency.fieldName} = ${dependency.fieldName};`,
      ),
      ...defaultControl.map((line) => `        ${line}`),
      '    }',
    );
  }
  if (
    motors.length === 0 &&
    mechanismConfigurations.length === 0 &&
    beamBreaks.length === 0 &&
    indicators.length === 0 &&
    directChildren.length === 0
  ) {
    lines.push(`    // No hardware devices or child nodes are configured for this ${node.kind}.`);
  }
  if (needsCommands)
    lines.push(
      '',
      ...stateMachineDeclaration(
        stateMachine.states,
        node.generateGoalCommand !== false,
        node.advantageKitLogging === true ? node.symbol : undefined,
      ),
    );
  if (controlledMechanism !== undefined && controlledMotor !== undefined) {
    lines.push(
      '',
      ...mechanismGoalControl(
        model,
        controlledMechanism,
        controlledMotor,
        stateMachine?.states ?? [],
      ),
    );
  } else if (beamBreaks.length > 0 && controlledMotor !== undefined && needsCommands) {
    lines.push('', ...indexerGoalControl(beamBreaks[0], stateMachine?.states ?? []));
  }
  lines.push('    // </frc-framework:managed>', '');
  for (const child of directChildren) {
    lines.push(
      `    public ${child.symbol} ${lowerFirst(child.symbol)}() {`,
      `        return ${lowerFirst(child.symbol)};`,
      '    }',
      '',
    );
  }
  for (const motor of motors) {
    lines.push(
      `    public MotorSubsystem ${lowerFirst(motor.symbol)}() {`,
      `        return ${lowerFirst(motor.symbol)};`,
      '    }',
      '',
    );
  }
  for (const sensor of beamBreaks) {
    const field = lowerFirst(sensor.symbol);
    const analog = stringParameter(sensor, 'portType') !== 'dio';
    const threshold = numberParameter(sensor, 'threshold', 2.5);
    const inverted = booleanParameter(sensor, 'inverted');
    lines.push(
      `    public boolean ${field}Broken() {`,
      `        boolean detected = ${analog ? `${field}.getVoltage() < ${javaNumber(threshold)}` : `!${field}.get()`};`,
      `        return ${inverted ? '!detected' : 'detected'};`,
      '    }',
      '',
    );
  }
  for (const indicator of indicators) {
    const field = lowerFirst(indicator.symbol);
    lines.push(
      `    public void set${indicator.symbol}Rgb(int red, int green, int blue) {`,
      `        for (int index = 0; index < ${field}Buffer.getLength(); index++) {`,
      `            ${field}Buffer.setRGB(index, red, green, blue);`,
      '        }',
      `        ${field}.setData(${field}Buffer);`,
      '    }',
      '',
    );
  }
  lines.push(...descendantMotorDelegates(model, node));
  if (motors.length > 0) {
    lines.push(
      '    private static MotorIO createMotorIO(MotorConfiguration config) {',
      '        return RobotBase.isReal() ? new MotorIOTalonFX(config) : new MotorIOSim(config);',
      '    }',
    );
  }
  lines.push('}', '');
  return lines.join('\n');
}

function presetOwnsDevice(model: FrcProjectModel, node: Subsystem, device: Device): boolean {
  const root = rootSubsystem(model, node);
  return (
    model.presets.some((preset) => preset.presetId === 'frc.swerve') &&
    root.javaFile?.replace(/\\/gu, '/').endsWith('/subsystems/swerve/SwerveSubsystem.java') ===
      true &&
    ['swerve-drive', 'swerve-steer', 'swerve-encoder', 'swerve-gyro'].includes(device.role ?? '')
  );
}

function descendantMotorDelegates(model: FrcProjectModel, node: Subsystem): readonly string[] {
  const lines: string[] = [];
  const descendantIds = new Set(descendants(model, node.id).map((entry) => entry.id));
  const motors = model.devices
    .filter((device) => descendantIds.has(device.parentId) && device.kind === 'motor')
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
  const directMemberNames = new Set(
    model.devices
      .filter((device) => device.parentId === node.id)
      .map((device) => lowerFirst(device.symbol)),
  );
  const nameCounts = new Map<string, number>();
  for (const motor of motors) {
    const name = lowerFirst(motor.symbol);
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }
  for (const motor of motors) {
    const owner = model.subsystems.find((entry) => entry.id === motor.parentId);
    let directChild = owner;
    while (directChild?.parentId !== node.id) {
      directChild = model.subsystems.find((entry) => entry.id === directChild?.parentId);
    }
    const methodName = lowerFirst(motor.symbol);
    if (
      owner === undefined ||
      directChild === undefined ||
      presetOwnsDevice(model, owner, motor) ||
      directMemberNames.has(methodName) ||
      nameCounts.get(methodName) !== 1
    )
      continue;
    lines.push(
      `    public MotorSubsystem ${methodName}() {`,
      `        return ${lowerFirst(directChild.symbol)}.${methodName}();`,
      '    }',
      '',
    );
  }
  return lines;
}

function beamBreakDeclaration(device: Device): readonly string[] {
  const field = lowerFirst(device.symbol);
  const channel = numberParameter(device, 'channel', 0);
  const analog = stringParameter(device, 'portType') !== 'dio';
  return [
    '',
    `    private final ${analog ? 'AnalogInput' : 'DigitalInput'} ${field} = new ${analog ? 'AnalogInput' : 'DigitalInput'}(${String(channel)});`,
  ];
}

function indicatorDeclaration(device: Device): readonly string[] {
  const field = lowerFirst(device.symbol);
  const channel = numberParameter(device, 'channel', 0);
  const length = numberParameter(device, 'length', 60);
  return [
    '',
    `    private final AddressableLED ${field} = new AddressableLED(${String(channel)});`,
    `    private final AddressableLEDBuffer ${field}Buffer = new AddressableLEDBuffer(${String(length)});`,
    '    {',
    `        ${field}.setLength(${field}Buffer.getLength());`,
    `        ${field}.setData(${field}Buffer);`,
    `        ${field}.start();`,
    '    }',
  ];
}

function mechanismSetpointDeclaration(device: Device): readonly string[] {
  const values = parameter(device, 'setpoints')?.value;
  const unit = stringParameter(device, 'setpointUnit') ?? '';
  const setpoints = Array.isArray(values)
    ? values.flatMap((entry) => {
        if (typeof entry !== 'string') return [];
        const match = /^\s*([A-Za-z_$][A-Za-z\d_$]*)\s*=\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*$/u.exec(
          entry,
        );
        return match?.[1] === undefined || match[2] === undefined
          ? []
          : [{ name: camelToUpperSnake(match[1]), value: Number(match[2]) }];
      })
    : [];
  const enumName = `${device.symbol}Setpoint`;
  return [
    '',
    `    /** Named ${escapeJavadoc(device.displayName)} setpoints in ${escapeJavadoc(unit || 'mechanism units')}. */`,
    `    public enum ${enumName} {`,
    ...(setpoints.length === 0
      ? ['        NONE(0.0);']
      : setpoints.map(
          (entry, index) =>
            `        ${entry.name}(${javaNumber(entry.value)})${index === setpoints.length - 1 ? ';' : ','}`,
        )),
    '',
    '        public final double value;',
    '',
    `        ${enumName}(double value) {`,
    '            this.value = value;',
    '        }',
    '    }',
    `    public static final String ${camelToUpperSnake(device.symbol)}_SETPOINT_UNIT = "${escapeJava(unit)}";`,
  ];
}

interface NamedSetpoint {
  readonly name: string;
  readonly value: number;
}

function namedSetpoints(device: Device): readonly NamedSetpoint[] {
  const values = parameter(device, 'setpoints')?.value;
  if (!Array.isArray(values)) return [];
  return values.flatMap((entry) => {
    if (typeof entry !== 'string') return [];
    const match = /^\s*([A-Za-z_$][A-Za-z\d_$]*)\s*=\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*$/u.exec(
      entry,
    );
    return match?.[1] === undefined || match[2] === undefined
      ? []
      : [{ name: camelToUpperSnake(match[1]), value: Number(match[2]) }];
  });
}

function mechanismDefaultControl(
  mechanism: Device | undefined,
  motor: Device | undefined,
): readonly string[] {
  if (mechanism === undefined || motor === undefined) return [];
  const field = lowerFirst(motor.symbol);
  return mechanism.catalogId === 'ironpulse.velocity-mechanism'
    ? [`${field}.setDefaultCommand(${field}.velocityCommand(this::goalSetpointRps));`]
    : mechanism.catalogId === 'ironpulse.position-mechanism'
      ? [`${field}.setDefaultCommand(${field}.positionCommand(this::goalSetpointRotations));`]
      : [];
}

function mechanismGoalControl(
  model: FrcProjectModel,
  mechanism: Device,
  motor: Device,
  states: readonly StateDefinition[],
): readonly string[] {
  const velocity = mechanism.catalogId === 'ironpulse.velocity-mechanism';
  const method = velocity ? 'goalSetpointRps' : 'goalSetpointRotations';
  const unit = stringParameter(mechanism, 'setpointUnit') ?? (velocity ? 'rps' : 'rot');
  const configured = new Map(namedSetpoints(mechanism).map((entry) => [entry.name, entry.value]));
  const cases = states.map((state) => {
    const goalName = camelToUpperSnake(state.symbol);
    const value = configured.get(goalName) ?? 0;
    return `            case ${goalName} -> ${javaNumber(convertSetpoint(value, unit, velocity))};`;
  });
  const tolerance = numberParameter(mechanism, 'tolerance', velocity ? 1 : 0.01);
  const convertedTolerance = convertSetpoint(tolerance, unit, velocity);
  const motorField = lowerFirst(motor.symbol);
  const zeroCommand = velocity
    ? []
    : [
        '',
        '    /** Homes this mechanism against its verified hard stop and records zero. */',
        '    public Command zeroCommand() {',
        `        return ${motorField}.zeroAgainstHardStopCommand(${numberExpression(model, motor, 'zeroingVoltage', -1)}, ${numberExpression(model, motor, 'zeroingCurrent', 30)}, ${integerExpression(model, motor, 'zeroingFilterSize', 5)});`,
        '    }',
      ];
  return [
    `    private double ${method}() {`,
    '        return switch (goal) {',
    ...cases,
    '        };',
    '    }',
    '',
    '    /** True when the primary motor is within the configured setpoint tolerance. */',
    '    public boolean atGoal() {',
    `        return ${motorField}.${velocity ? 'atVelocity' : 'atPosition'}(${method}(), ${javaNumber(convertedTolerance)});`,
    '    }',
    ...zeroCommand,
  ];
}

function indexerGoalControl(
  beamBreak: Device | undefined,
  states: readonly StateDefinition[],
): readonly string[] {
  const active = states.find((state) => !/^idle$/iu.test(state.symbol)) ?? states[0];
  if (active === undefined) return [];
  const sensorReady = beamBreak === undefined ? '' : ` && !${lowerFirst(beamBreak.symbol)}Broken()`;
  return [
    '    /** Runs while active and the beam is clear; IDLE or a detected piece commands zero. */',
    '    private double goalDutyCycle() {',
    `        return goal == Goal.${camelToUpperSnake(active.symbol)}${sensorReady} ? 1.0 : 0.0;`,
    '    }',
  ];
}

function convertSetpoint(value: number, unit: string, velocity: boolean): number {
  if (velocity) {
    if (unit === 'rpm') return value / 60;
    return value;
  }
  if (unit === 'deg') return value / 360;
  if (unit === 'rad') return value / (2 * Math.PI);
  return value;
}

function motorConfigurationDeclaration(model: FrcProjectModel, device: Device): readonly string[] {
  const inversion = enumExpression(
    model,
    device,
    'inversion',
    'clockwisePositive',
    'InvertedValue.Clockwise_Positive',
    'InvertedValue.CounterClockwise_Positive',
  );
  const neutral = enumExpression(model, device, 'neutralMode', 'brake', 'true', 'false');
  const ratio = numberParameter(device, 'sensorToMechanismRatio', 1);
  const stator = numberParameter(device, 'statorCurrentLimit', Number.NaN);
  const supply = numberParameter(device, 'supplyCurrentLimit', Number.NaN);
  const ramp = numberParameter(device, 'openLoopRamp', 0);
  const closedRamp = numberParameter(device, 'closedLoopRamp', 0);
  const gains = ['kP', 'kI', 'kD', 'kS', 'kV', 'kA', 'kG'].map((key) =>
    numberParameter(device, key, 0),
  );
  const forwardEnabled = booleanParameter(device, 'forwardSoftLimitEnabled');
  const reverseEnabled = booleanParameter(device, 'reverseSoftLimitEnabled');
  const softConfigured =
    parameter(device, 'forwardSoftLimitEnabled') !== undefined ||
    parameter(device, 'reverseSoftLimitEnabled') !== undefined;
  const reverse = numberParameter(device, 'reverseSoftLimit', 0);
  const forward = numberParameter(device, 'forwardSoftLimit', 0);
  const gearing = numberParameter(device, 'simGearRatio', 1);
  const inertia = numberParameter(device, 'simInertia', 0.001);
  const friction = numberParameter(device, 'simFrictionVoltage', 0);
  const simMinimum = numberParameter(device, 'simMinimum', Number.NEGATIVE_INFINITY);
  const simMaximum = numberParameter(device, 'simMaximum', Number.POSITIVE_INFINITY);
  const gravityType = stringParameter(device, 'gravityType') ?? 'elevatorStatic';
  const staticFeedforwardSign =
    stringParameter(device, 'staticFeedforwardSign') ?? 'closedLoopSign';
  const remoteEnabled = booleanParameter(device, 'remoteEncoderEnabled');
  const remoteId = numberParameter(device, 'remoteEncoderId', 0);
  const remoteCanBus = stringParameter(device, 'remoteEncoderCanBus') ?? device.canBus ?? 'rio';
  const remoteMagnetOffset = numberParameter(device, 'remoteEncoderMagnetOffset', 0);
  const remoteSensorDirection =
    stringParameter(device, 'remoteEncoderSensorDirection') ?? 'counterClockwisePositive';
  const rotorRatio = numberParameter(device, 'rotorToSensorRatio', 1);
  const feedbackSource = stringParameter(device, 'feedbackSource') ?? 'fusedCANcoder';
  const continuousWrap = booleanParameter(device, 'continuousWrap');
  const motionVelocity = numberParameter(device, 'motionMagicVelocity', 0);
  const motionAcceleration = numberParameter(device, 'motionMagicAcceleration', 0);
  const motionJerk = numberParameter(device, 'motionMagicJerk', 0);
  const zeroingVoltage = numberParameter(device, 'zeroingVoltage', -2);
  const zeroingCurrent = numberParameter(device, 'zeroingCurrent', 40);
  const zeroingFilterSize = numberParameter(device, 'zeroingFilterSize', 5);
  const zeroOffset = numberParameter(device, 'zeroOffset', 0);
  const tolerance = numberParameter(device, 'tolerance', 0.01);
  const leaderId = stringParameter(device, 'leaderId');
  const leader = model.devices.find((entry) => entry.id === leaderId);
  const opposeLeader = booleanParameter(device, 'opposeLeader');
  const configName = `${lowerFirst(device.symbol)}Configuration`;
  const declarationStart = [
    `    public static MotorConfiguration ${configName}() {`,
    `        return MotorConfiguration.talonFx("${escapeJava(device.displayName)}", ${String(device.canId ?? 0)})`,
  ];
  const indentation = '                ';
  return [
    ...declarationStart,
    ...(device.canBus === undefined || device.canBus === 'rio'
      ? []
      : [`${indentation}.canBus("${escapeJava(device.canBus)}")`]),
    `${indentation}.inverted(${inversion})`,
    `${indentation}.brake(${neutral})`,
    `${indentation}.sensorToMechanismRatio(${numberExpression(model, device, 'sensorToMechanismRatio', ratio)})`,
    ...(Number.isNaN(stator) && Number.isNaN(supply)
      ? []
      : [
          `${indentation}.currentLimits(${numberExpression(model, device, 'statorCurrentLimit', stator)}, ${numberExpression(model, device, 'supplyCurrentLimit', supply)})`,
        ]),
    ...(ramp === 0
      ? []
      : [`${indentation}.openLoopRamp(${numberExpression(model, device, 'openLoopRamp', ramp)})`]),
    ...(closedRamp === 0 && parameter(device, 'closedLoopRamp') === undefined
      ? []
      : [
          `${indentation}.closedLoopRamp(${numberExpression(model, device, 'closedLoopRamp', closedRamp)})`,
        ]),
    ...(gains.every((value) => value === 0)
      ? []
      : [
          `${indentation}.gains(new MotorConfiguration.Gains(${['kP', 'kI', 'kD', 'kS', 'kV', 'kA', 'kG'].map((key, index) => numberExpression(model, device, key, gains[index] ?? 0)).join(', ')}))`,
        ]),
    ...(parameter(device, 'gravityType') === undefined
      ? []
      : [
          `${indentation}.gravityType(${stringExpression(model, device, 'gravityType', gravityType)})`,
        ]),
    ...(parameter(device, 'staticFeedforwardSign') === undefined
      ? []
      : [
          `${indentation}.staticFeedforwardSign(${stringExpression(model, device, 'staticFeedforwardSign', staticFeedforwardSign)})`,
        ]),
    ...(parameter(device, 'remoteEncoderEnabled') === undefined
      ? []
      : [
          `${indentation}.remoteEncoder(new MotorConfiguration.RemoteEncoder(${booleanExpression(model, device, 'remoteEncoderEnabled', remoteEnabled)}, ${integerExpression(model, device, 'remoteEncoderId', remoteId)}, ${stringExpression(model, device, 'remoteEncoderCanBus', remoteCanBus)}, ${numberExpression(model, device, 'remoteEncoderMagnetOffset', remoteMagnetOffset)}, ${stringExpression(model, device, 'remoteEncoderSensorDirection', remoteSensorDirection)}, ${numberExpression(model, device, 'rotorToSensorRatio', rotorRatio)}, ${stringExpression(model, device, 'feedbackSource', feedbackSource)}))`,
        ]),
    ...(parameter(device, 'continuousWrap') === undefined
      ? []
      : [
          `${indentation}.continuousWrap(${booleanExpression(model, device, 'continuousWrap', continuousWrap)})`,
        ]),
    ...(softConfigured
      ? [
          `${indentation}.softLimits(new MotorConfiguration.SoftLimits(${booleanExpression(model, device, 'reverseSoftLimitEnabled', reverseEnabled)}, ${numberExpression(model, device, 'reverseSoftLimit', reverse)}, ${booleanExpression(model, device, 'forwardSoftLimitEnabled', forwardEnabled)}, ${numberExpression(model, device, 'forwardSoftLimit', forward)}))`,
        ]
      : []),
    ...(parameter(device, 'zeroOffset') === undefined
      ? []
      : [
          `${indentation}.zeroOffsetRotations(${numberExpression(model, device, 'zeroOffset', zeroOffset)})`,
        ]),
    ...(parameter(device, 'motionMagicVelocity') === undefined &&
    parameter(device, 'motionMagicAcceleration') === undefined &&
    parameter(device, 'motionMagicJerk') === undefined
      ? []
      : [
          `${indentation}.motionMagic(new MotorConfiguration.MotionMagic(${numberExpression(model, device, 'motionMagicVelocity', motionVelocity)}, ${numberExpression(model, device, 'motionMagicAcceleration', motionAcceleration)}, ${numberExpression(model, device, 'motionMagicJerk', motionJerk)}))`,
        ]),
    ...(parameter(device, 'zeroingVoltage') === undefined &&
    parameter(device, 'zeroingCurrent') === undefined &&
    parameter(device, 'zeroingFilterSize') === undefined
      ? []
      : [
          `${indentation}.zeroing(new MotorConfiguration.Zeroing(${numberExpression(model, device, 'zeroingVoltage', zeroingVoltage)}, ${numberExpression(model, device, 'zeroingCurrent', zeroingCurrent)}, ${integerExpression(model, device, 'zeroingFilterSize', zeroingFilterSize)}))`,
        ]),
    ...(parameter(device, 'tolerance') === undefined
      ? []
      : [`${indentation}.tolerance(${numberExpression(model, device, 'tolerance', tolerance)})`]),
    ...(leader?.canId === undefined
      ? []
      : [
          `${indentation}.follower(new MotorConfiguration.Follower(true, ${String(leader.canId)}, ${booleanExpression(model, device, 'opposeLeader', opposeLeader)}))`,
        ]),
    ...(gearing === 1 &&
    inertia === 0.001 &&
    friction === 0 &&
    simMinimum === Number.NEGATIVE_INFINITY &&
    simMaximum === Number.POSITIVE_INFINITY
      ? []
      : [
          `${indentation}.simulation(new MotorConfiguration.Simulation(${numberExpression(model, device, 'simGearRatio', gearing)}, ${numberExpression(model, device, 'simInertia', inertia)}, ${numberExpression(model, device, 'simFrictionVoltage', friction)}, ${numberExpression(model, device, 'simMinimum', simMinimum)}, ${numberExpression(model, device, 'simMaximum', simMaximum)}))`,
        ]),
    `${indentation}.build();`,
    '    }',
  ];
}

function motorFieldDeclaration(node: Subsystem, device: Device): readonly string[] {
  const field = lowerFirst(device.symbol);
  const config = `${node.symbol}Config.${field}Configuration()`;
  const hasTuning = device.parameters.some(
    (parameter) => parameter.networkTables?.enabled === true,
  );
  return [
    `    private final MotorSubsystem ${field} =`,
    ...(hasTuning
      ? [
          `            new MotorSubsystem("${escapeJava(device.displayName)}", createMotorIO(${config}),`,
          `                    ${node.symbol}Config::${field}Configuration, ${node.symbol}Config::tuningChanged);`,
        ]
      : [
          `            new MotorSubsystem("${escapeJava(device.displayName)}", createMotorIO(${config}));`,
        ]),
  ];
}

function subsystemConfigJava(
  model: FrcProjectModel,
  node: Subsystem,
  packageName: string,
  motors: readonly Device[],
): string {
  const hasTuning = motors.some((device) =>
    device.parameters.some((parameter) => parameter.networkTables?.enabled === true),
  );
  const tuningFields = motors.flatMap((device) =>
    device.parameters
      .filter((parameter) => parameter.networkTables?.enabled === true)
      .map((parameter) => `TuningParameters.${tuningFieldName(model, parameter.id)}.hasChanged()`),
  );
  const imports = [
    'com.ctre.phoenix6.signals.InvertedValue',
    ...(hasTuning ? [`${model.project.javaPackage}.tuning.TuningParameters`] : []),
    'lib.ironpulse.subsystem.MotorConfiguration',
  ];
  return [
    `package ${packageName};`,
    '',
    ...imports.sort().map((entry) => `import ${entry};`),
    '',
    `/** Hardware constants and motor configuration for {@link ${node.symbol}}. */`,
    `public final class ${node.symbol}Config {`,
    '    // <frc-framework:managed>',
    ...motors.flatMap((motor, index) => [
      ...(index === 0 ? [] : ['']),
      ...motorConfigurationDeclaration(model, motor),
    ]),
    ...(hasTuning
      ? [
          '',
          '    /** True when a NetworkTables tuning value must be reapplied to hardware. */',
          '    public static boolean tuningChanged() {',
          `        return ${tuningFields.join('\n                || ')};`,
          '    }',
        ]
      : []),
    '',
    `    private ${node.symbol}Config() {}`,
    '    // </frc-framework:managed>',
    '}',
    '',
  ].join('\n');
}

function tuningParametersJava(model: FrcProjectModel): string {
  const declarations = collectTuningParameters(model);
  const fields = declarations.map((entry) => {
    const field = tuningFieldName(model, entry.parameterId);
    const parameter = model.devices
      .flatMap((device) => device.parameters)
      .find((candidate) => candidate.id === entry.parameterId);
    if (parameter === undefined) throw new Error(`Missing tuning parameter ${entry.parameterId}.`);
    return {
      declaration: `    public static final NTParameterWrapper<${javaWrapperType(parameter)}> ${field} =\n            new NTParameterWrapper<>("${escapeJava(entry.path)}", ${javaParameterValue(parameter.value)});`,
      field,
    };
  });
  return `package ${model.project.javaPackage}.tuning;

import lib.ntext.NTParameterWrapper;

/** Generated typed NetworkTables parameters. Paths and defaults come from project.yaml. */
public final class TuningParameters {
    // <frc-framework:managed>
${fields.length === 0 ? '    // No parameters are published to NetworkTables.' : fields.map((entry) => entry.declaration).join('\n\n')}

    private TuningParameters() {}

    public static boolean isAnyChanged() {
        return ${fields.length === 0 ? 'false' : fields.map((entry) => `${entry.field}.hasChanged()`).join('\n                || ')};
    }
    // </frc-framework:managed>
}
`;
}

function numberExpression(
  model: FrcProjectModel,
  device: Device,
  key: string,
  fallback: number,
): string {
  const parameter = device.parameters.find((entry) => entry.key === key);
  if (parameter?.networkTables?.enabled === true && parameter.type === 'number') {
    return `TuningParameters.${tuningFieldName(model, parameter.id)}.getValue()`;
  }
  return javaNumber(fallback);
}

function integerExpression(
  model: FrcProjectModel,
  device: Device,
  key: string,
  fallback: number,
): string {
  return `(int) Math.round(${numberExpression(model, device, key, fallback)})`;
}

function booleanExpression(
  model: FrcProjectModel,
  device: Device,
  key: string,
  fallback: boolean,
): string {
  const configured = parameter(device, key);
  if (configured?.networkTables?.enabled === true && configured.type === 'boolean') {
    return `TuningParameters.${tuningFieldName(model, configured.id)}.getValue()`;
  }
  return String(fallback);
}

function stringExpression(
  model: FrcProjectModel,
  device: Device,
  key: string,
  fallback: string,
): string {
  const configured = parameter(device, key);
  if (
    configured?.networkTables?.enabled === true &&
    (configured.type === 'string' || configured.type === 'enum')
  ) {
    return `TuningParameters.${tuningFieldName(model, configured.id)}.getValue()`;
  }
  return `"${escapeJava(fallback)}"`;
}

function enumExpression(
  model: FrcProjectModel,
  device: Device,
  key: string,
  matchingValue: string,
  matchingExpression: string,
  otherExpression: string,
): string {
  const configured = parameter(device, key);
  if (
    configured?.networkTables?.enabled === true &&
    (configured.type === 'string' || configured.type === 'enum')
  ) {
    return `TuningParameters.${tuningFieldName(model, configured.id)}.getValue().equals("${escapeJava(matchingValue)}") ? ${matchingExpression} : ${otherExpression}`;
  }
  return configured?.value === matchingValue ? matchingExpression : otherExpression;
}

function tuningFieldName(model: FrcProjectModel, parameterId: string): string {
  const declarations = collectTuningParameters(model);
  const target = declarations.find((entry) => entry.parameterId === parameterId);
  if (target === undefined) throw new Error(`Parameter ${parameterId} is not published to NT.`);
  const base = camelToUpperSnake(
    `${target.subsystemName}_${target.mechanismName}_${target.deviceName}_${target.key}`,
  );
  const matching = declarations.filter(
    (entry) =>
      camelToUpperSnake(
        `${entry.subsystemName}_${entry.mechanismName}_${entry.deviceName}_${entry.key}`,
      ) === base,
  );
  const index = matching.findIndex((entry) => entry.parameterId === parameterId);
  return matching.length === 1 ? base : `${base}_${String(index + 1)}`;
}

function javaWrapperType(parameter: DeviceParameter): string {
  switch (parameter.type) {
    case 'boolean':
      return 'Boolean';
    case 'number':
      return 'Double';
    case 'number[]':
      return 'double[]';
    case 'string[]':
      return 'String[]';
    case 'enum':
    case 'string':
      return 'String';
  }
}

function javaParameterValue(value: DeviceParameter['value']): string {
  if (typeof value === 'number') return javaNumber(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'string') return `"${escapeJava(value)}"`;
  if (value.every((entry) => typeof entry === 'number')) {
    return `new double[] {${value.map((entry) => javaNumber(entry as number)).join(', ')}}`;
  }
  return `new String[] {${value.map((entry) => `"${escapeJava(String(entry))}"`).join(', ')}}`;
}

function stateMachineDeclaration(
  states: readonly StateDefinition[],
  generateCommand: boolean,
  loggingPrefix?: string,
): readonly string[] {
  const sorted = [...states].sort((left, right) => left.symbol.localeCompare(right.symbol));
  const initial = sorted.find((state) => state.initial === true) ?? sorted[0];
  return [
    '    public enum Goal {',
    `        ${sorted.map((state) => camelToUpperSnake(state.symbol)).join(',\n        ')}`,
    '    }',
    '',
    `    private Goal goal = Goal.${camelToUpperSnake(initial?.symbol ?? 'Idle')};`,
    '',
    ...(loggingPrefix === undefined
      ? []
      : [`    @AutoLogOutput(key = "${escapeJava(loggingPrefix)}/Goal")`]),
    '    public Goal goal() {',
    '        return goal;',
    '    }',
    '',
    '    public void setGoal(Goal value) {',
    '        goal = value;',
    '    }',
    '',
    ...(generateCommand
      ? [
          '    public Command setGoalCommand(Goal value) {',
          '        return edu.wpi.first.wpilibj2.command.Commands.runOnce(() -> setGoal(value), this);',
          '    }',
        ]
      : []),
  ];
}

function robotContainerJava(model: FrcProjectModel): string {
  const nodes = compositionOrder(model);
  const swerve = swerveSubsystem(model);
  const driverAxes = driverAxisConfiguration(model);
  const symbolCounts = new Map<string, number>();
  for (const node of nodes) symbolCounts.set(node.symbol, (symbolCounts.get(node.symbol) ?? 0) + 1);
  const imports = nodes
    .filter((entry) => symbolCounts.get(entry.symbol) === 1)
    .map((entry) => {
      const location = subsystemJavaLocation(model, entry);
      return `import ${location.packageName}.${entry.symbol};`;
    });
  const calibrationMotors = model.devices
    .filter((device) => device.kind === 'motor')
    .flatMap((device) => {
      const owner = model.subsystems.find((entry) => entry.id === device.parentId);
      return owner === undefined || presetOwnsDevice(model, owner, device)
        ? []
        : [
            {
              device,
              expression: `${compositionFieldName(model, owner)}.${lowerFirst(device.symbol)}()`,
            },
          ];
    });
  const defaultDrive =
    swerve === undefined || driverAxes === undefined
      ? ''
      : `        ${compositionFieldName(model, swerve)}.setDefaultCommand(${compositionFieldName(model, swerve)}.teleopDriveCommand(operatorInterface::driverForward, operatorInterface::driverLeft, operatorInterface::driverRotation));\n`;
  return `package ${model.project.javaPackage};

import edu.wpi.first.wpilibj2.command.Command;
import ${model.project.javaPackage}.auto.AutoManager;
import ${model.project.javaPackage}.commands.RobotCommands;
import ${model.project.javaPackage}.controls.OperatorInterface;
import ${model.project.javaPackage}.calibration.RobotCalibration;
import ${model.project.javaPackage}.telemetry.RobotTelemetry;
import java.util.Map;
${imports.length === 0 ? '' : `${imports.join('\n')}\n`}
/** Readable composition root. Robot-specific behavior belongs in the packages below. */
public final class RobotContainer {
    // <frc-framework:managed>
${nodes
  .map((entry) => {
    const argumentsList = [
      ...children(model, entry.id).map((child) => compositionFieldName(model, child)),
      ...(entry.dependencies ?? [])
        .map((dependency) =>
          model.subsystems.find((candidate) => candidate.id === dependency.targetSubsystemId),
        )
        .filter((target): target is Subsystem => target !== undefined)
        .map((target) => compositionFieldName(model, target)),
    ];
    const type =
      symbolCounts.get(entry.symbol) === 1
        ? entry.symbol
        : `${subsystemJavaLocation(model, entry).packageName}.${entry.symbol}`;
    return `    private final ${type} ${compositionFieldName(model, entry)} = new ${type}(${argumentsList.join(', ')});`;
  })
  .join('\n')}${nodes.length === 0 ? '    // No robot subsystems are configured.' : ''}
    private final RobotCommands commands = new RobotCommands(${commandRequirements(model)
      .map((entry) => compositionFieldName(model, entry))
      .join(', ')});
    private final OperatorInterface operatorInterface = new OperatorInterface();
    private final AutoManager autoManager = new AutoManager();
    private final RobotTelemetry telemetry = new RobotTelemetry();
    private final RobotCalibration calibration = new RobotCalibration(${
      calibrationMotors.length === 0
        ? 'Map.of()'
        : `Map.ofEntries(${calibrationMotors
            .map(
              ({ device, expression }) =>
                `\n            Map.entry("${escapeJava(device.id)}", ${expression})`,
            )
            .join(',')}\n    )`
    });
    // </frc-framework:managed>

    public void initialize() {
        commands.configureDefaults();
${defaultDrive}        operatorInterface.configureBindings(commands);
        autoManager.configure(commands);
        telemetry.publish();
    }

    public void periodic() {
        telemetry.periodic();
        calibration.periodic();
    }

    public Command getAutonomousCommand() {
        return autoManager.selectedCommand();
    }
}
`;
}

function robotTelemetryJava(model: FrcProjectModel): string {
  const fieldEnabled = model.robot.telemetry?.fieldPublisher !== false;
  const recorderEnabled = model.robot.telemetry?.stateRecorder !== false;
  return `package ${model.project.javaPackage}.telemetry;

/** Single runtime aggregation point for robot, field, and diagnostic telemetry. */
public final class RobotTelemetry {
    // <frc-framework:managed>
${fieldEnabled ? '    private final FieldPublisher field = new FieldPublisher();' : '    // Field publishing is disabled in project.yaml.'}
${recorderEnabled ? '    private final RobotStateRecorder state = new RobotStateRecorder();' : '    // Robot state recording is disabled in project.yaml.'}

    public void publish() {
${fieldEnabled ? '        field.publish();' : '        // No dashboard sendables are enabled.'}
    }

    public void periodic() {
${recorderEnabled ? '        state.record();' : ''}${fieldEnabled && recorderEnabled ? '\n' : ''}${fieldEnabled ? '        field.periodic();' : ''}${!fieldEnabled && !recorderEnabled ? '        // No periodic telemetry is enabled.' : ''}
    }
${fieldEnabled ? '\n    public FieldPublisher field() {\n        return field;\n    }\n' : ''}    // </frc-framework:managed>
}
`;
}

function fieldPublisherJava(model: FrcProjectModel): string {
  return `package ${model.project.javaPackage}.telemetry;

import edu.wpi.first.math.geometry.Pose2d;
import edu.wpi.first.wpilibj.smartdashboard.Field2d;
import edu.wpi.first.wpilibj.smartdashboard.SmartDashboard;

/** Owns Field2d publication; subsystems provide poses without depending on dashboard APIs. */
public final class FieldPublisher {
    // <frc-framework:managed>
    private final Field2d field = new Field2d();

    public void publish() {
        SmartDashboard.putData("Field", field);
    }

    public void setRobotPose(Pose2d pose) {
        field.setRobotPose(pose);
    }

    public void setObjectPose(String name, Pose2d pose) {
        field.getObject(name).setPose(pose);
    }

    public void periodic() {
        // Add pose suppliers in custom code or call setRobotPose from the composition root.
    }

    public Field2d field() {
        return field;
    }
    // </frc-framework:managed>
}
`;
}

function robotStateRecorderJava(model: FrcProjectModel): string {
  return `package ${model.project.javaPackage}.telemetry;

import edu.wpi.first.wpilibj.DriverStation;
import edu.wpi.first.wpilibj.RobotController;
import org.littletonrobotics.junction.Logger;

/** Records lifecycle and electrical state in one predictable AdvantageKit namespace. */
public final class RobotStateRecorder {
    // <frc-framework:managed>
    public void record() {
        Logger.recordOutput("Robot/Enabled", DriverStation.isEnabled());
        Logger.recordOutput("Robot/Autonomous", DriverStation.isAutonomous());
        Logger.recordOutput("Robot/Teleop", DriverStation.isTeleop());
        Logger.recordOutput("Robot/Test", DriverStation.isTest());
        Logger.recordOutput("Robot/DriverStationAttached", DriverStation.isDSAttached());
        Logger.recordOutput("Robot/BrownedOut", RobotController.isBrownedOut());
        Logger.recordOutput("Robot/BatteryVoltage", RobotController.getBatteryVoltage());
        Logger.recordOutput("Robot/MatchTime", DriverStation.getMatchTime());
        Logger.recordOutput(
                "Robot/Alliance",
                DriverStation.getAlliance().map(Enum::name).orElse("Unknown"));
    }
    // </frc-framework:managed>
}
`;
}

function robotCalibrationJava(model: FrcProjectModel): string {
  return `package ${model.project.javaPackage}.calibration;

import edu.wpi.first.math.MathUtil;
import edu.wpi.first.networktables.NetworkTable;
import edu.wpi.first.networktables.NetworkTableInstance;
import edu.wpi.first.wpilibj.DriverStation;
import edu.wpi.first.wpilibj.Timer;
import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.CommandScheduler;
import java.util.Map;
import lib.ironpulse.subsystem.MotorSubsystem;

/** Guarded bridge for short, low-power mechanism direction checks in Test mode only. */
public final class RobotCalibration {
    // <frc-framework:managed>
    private static final double MAX_OUTPUT = 0.15;
    private static final double MAX_DURATION_SECONDS = 2.0;
    private final Map<String, MotorSubsystem> motors;
    private final NetworkTable table =
            NetworkTableInstance.getDefault().getTable("FRCFramework/Calibration");
    private Command active;
    private double stopAt;

    public RobotCalibration(Map<String, MotorSubsystem> motors) {
        this.motors = Map.copyOf(motors);
    }

    public void periodic() {
        boolean requested = table.getEntry("Enabled").getBoolean(false);
        if (active != null
                && (!requested || !DriverStation.isTestEnabled() || Timer.getFPGATimestamp() >= stopAt)) {
            stop("stopped");
        }
        if (!requested || active != null) return;
        if (!DriverStation.isTestEnabled()) {
            reject("Robot must be Test Enabled");
            return;
        }
        String deviceId = table.getEntry("DeviceId").getString("");
        MotorSubsystem motor = motors.get(deviceId);
        if (motor == null) {
            reject("Unknown motor device");
            return;
        }
        double output = MathUtil.clamp(
                table.getEntry("Output").getDouble(0.0), -MAX_OUTPUT, MAX_OUTPUT);
        double duration = MathUtil.clamp(
                table.getEntry("DurationSeconds").getDouble(0.5), 0.05, MAX_DURATION_SECONDS);
        stopAt = Timer.getFPGATimestamp() + duration;
        active = motor.dutyCycleCommand(output).withTimeout(duration);
        CommandScheduler.getInstance().schedule(active);
        table.getEntry("Status").setString("running");
    }

    private void reject(String reason) {
        table.getEntry("Status").setString(reason);
        table.getEntry("Enabled").setBoolean(false);
    }

    private void stop(String status) {
        if (active != null) CommandScheduler.getInstance().cancel(active);
        active = null;
        table.getEntry("Enabled").setBoolean(false);
        table.getEntry("Status").setString(status);
    }
    // </frc-framework:managed>
}
`;
}

function operatorInterfaceJava(model: FrcProjectModel): string {
  const controllers = [...model.controllers].sort((left, right) =>
    left.symbol.localeCompare(right.symbol),
  );
  const bindings = [...model.bindings].sort((left, right) => left.id.localeCompare(right.id));
  const providerImports = [...new Set(controllers.map((controller) => controller.provider))]
    .filter((provider) => /^[A-Za-z_$][\w$]*$/u.test(provider))
    .map((provider) => `import edu.wpi.first.wpilibj2.command.button.${provider};`)
    .sort();
  const driverAxes = driverAxisConfiguration(model);
  return `package ${model.project.javaPackage}.controls;

${driverAxes === undefined ? '' : 'import edu.wpi.first.math.MathUtil;\n'}import ${model.project.javaPackage}.commands.RobotCommands;
${providerImports.join('\n')}${providerImports.length === 0 ? '' : '\n'}
/** Controller declarations and trigger bindings. Complex input math remains ordinary Java. */
public final class OperatorInterface {
    // <frc-framework:managed>
${controllers
  .map(
    (controller) =>
      `    private final ${controller.provider} ${controller.symbol} = new ${controller.provider}(${String(controller.port)});`,
  )
  .join('\n')}${controllers.length === 0 ? '    // No controllers configured.' : ''}
    // </frc-framework:managed>

    public void configureBindings(RobotCommands commands) {
        // <frc-framework:managed>
${bindings.map((binding) => bindingJava(model, binding)).join('\n')}${bindings.length === 0 ? '        // No bindings configured.' : ''}
        // </frc-framework:managed>
    }
${
  driverAxes === undefined
    ? ''
    : `
    /** Shaped field-forward input used by the generated Swerve default command. */
    public double driverForward() {
        return MathUtil.applyDeadband(${driverAxes.forward}, ${javaNumber(driverAxes.deadband)}) * ${javaNumber(driverAxes.scale)};
    }

    /** Shaped field-left input used by the generated Swerve default command. */
    public double driverLeft() {
        return MathUtil.applyDeadband(${driverAxes.left}, ${javaNumber(driverAxes.deadband)}) * ${javaNumber(driverAxes.scale)};
    }

    /** Shaped counter-clockwise rotation input used by the generated Swerve default command. */
    public double driverRotation() {
        return MathUtil.applyDeadband(${driverAxes.rotation}, ${javaNumber(driverAxes.deadband)}) * ${javaNumber(driverAxes.scale)};
    }
`
}
}
`;
}

function swerveSubsystem(model: FrcProjectModel): Subsystem | undefined {
  if (!model.presets.some((preset) => preset.presetId === 'frc.swerve')) return undefined;
  return model.subsystems.find(
    (entry) =>
      entry.javaFile?.replace(/\\/gu, '/').endsWith('/subsystems/swerve/SwerveSubsystem.java') ===
      true,
  );
}

interface DriverAxisConfiguration {
  readonly deadband: number;
  readonly forward: string;
  readonly left: string;
  readonly rotation: string;
  readonly scale: number;
}

function driverAxisConfiguration(model: FrcProjectModel): DriverAxisConfiguration | undefined {
  if (swerveSubsystem(model) === undefined) return undefined;
  const controller = model.controllers.find((entry) => entry.role === 'driver');
  if (controller === undefined) return undefined;
  const field = controller.symbol;
  let axes:
    | {
        readonly forward: readonly [string, number];
        readonly left: readonly [string, number];
        readonly rotation: readonly [string, number];
      }
    | undefined;
  if (controller.provider === 'CommandXboxController') {
    axes = {
      forward: [`${field}.getLeftY()`, 1],
      left: [`${field}.getLeftX()`, 0],
      rotation: [`${field}.getRightX()`, 4],
    };
  } else if (['CommandPS4Controller', 'CommandPS5Controller'].includes(controller.provider)) {
    axes = {
      forward: [`${field}.getLeftY()`, 1],
      left: [`${field}.getLeftX()`, 0],
      rotation: [`${field}.getRightX()`, 2],
    };
  } else if (controller.provider === 'CommandJoystick') {
    axes = {
      forward: [`${field}.getY()`, 1],
      left: [`${field}.getX()`, 0],
      rotation: [`${field}.getTwist()`, 2],
    };
  } else if (controller.provider === 'CommandGenericHID') {
    axes = {
      forward: [`${field}.getHID().getRawAxis(1)`, 1],
      left: [`${field}.getHID().getRawAxis(0)`, 0],
      rotation: [`${field}.getHID().getRawAxis(4)`, 4],
    };
  }
  if (axes === undefined) return undefined;
  const expression = ([value, index]: readonly [string, number]): string => {
    const invertedByUser = controller.invertAxes?.includes(index) === true;
    return `${invertedByUser ? '' : '-'}${value}`;
  };
  return {
    deadband: controller.deadband ?? 0.08,
    forward: expression(axes.forward),
    left: expression(axes.left),
    rotation: expression(axes.rotation),
    scale: controller.axisScale ?? 1,
  };
}

function bindingJava(model: FrcProjectModel, binding: FrcProjectModel['bindings'][number]): string {
  const controller = model.controllers.find((entry) => entry.id === binding.controllerId);
  const command = model.commands.find((entry) => entry.id === binding.commandId);
  if (
    controller === undefined ||
    command === undefined ||
    binding.behavior === 'custom' ||
    binding.behavior === 'axis'
  ) {
    return `        // Custom binding: ${escapeJava(binding.codeReference ?? binding.input)}`;
  }
  const trigger = triggerJava(controller.symbol, binding.input);
  let commandCall = `commands.${command.symbol}()`;
  if (binding.timeoutSeconds !== undefined)
    commandCall += `.withTimeout(${javaNumber(binding.timeoutSeconds)})`;
  return `        ${trigger}.${binding.behavior}(${commandCall});`;
}

function triggerJava(controller: string, input: string): string {
  const or = splitCondition(input, '|');
  if (or.length > 1)
    return (
      or.map((entry) => triggerJava(controller, entry)).join('.or(') + ')'.repeat(or.length - 1)
    );
  const and = splitCondition(input, '&');
  if (and.length > 1)
    return (
      and.map((entry) => triggerJava(controller, entry)).join('.and(') + ')'.repeat(and.length - 1)
    );
  if (input.startsWith('!')) return `${triggerJava(controller, input.slice(1))}.negate()`;
  if (/^[A-Za-z_$][\w$]*$/u.test(input)) return `${controller}.${input}()`;
  const button = /^button:(\d+)$/u.exec(input)?.[1];
  if (button !== undefined) return `${controller}.button(${button})`;
  const pov = /^pov:(\d+)$/u.exec(input)?.[1];
  if (pov !== undefined) return `${controller}.pov(${pov})`;
  const axis = /^axis:(\d+)>(-?\d+(?:\.\d+)?)$/u.exec(input);
  if (axis !== null) return `${controller}.axisGreaterThan(${axis[1]}, ${axis[2]})`;
  return input;
}

function splitCondition(value: string, operator: string): readonly string[] {
  return value
    .split(operator)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function autoActionsJava(model: FrcProjectModel): string {
  const named = model.commands.filter((entry) => entry.pathplannerName !== undefined);
  return `package ${model.project.javaPackage}.auto;

import com.pathplanner.lib.auto.NamedCommands;
import ${model.project.javaPackage}.commands.RobotCommands;

/** Registers PathPlanner named commands from the structured command catalog. */
public final class AutoActions {
    private AutoActions() {}

    public static void configure(RobotCommands commands) {
        // <frc-framework:managed>
${named.length === 0 ? '        // No PathPlanner named commands configured.' : named.map((command) => `        NamedCommands.registerCommand("${escapeJava(command.pathplannerName ?? '')}", commands.${command.symbol}());`).join('\n')}
        // </frc-framework:managed>
    }
}
`;
}

function autoRoutinesJava(model: FrcProjectModel): string {
  return `package ${model.project.javaPackage}.auto;

import edu.wpi.first.wpilibj.smartdashboard.SendableChooser;
import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.Commands;
import ${model.project.javaPackage}.commands.RobotCommands;

/** Composes generated choices while keeping complex routines in ordinary Java. */
public final class AutoRoutines {
    private AutoRoutines() {}

    public static void configure(SendableChooser<Command> chooser, RobotCommands commands) {
        // <frc-framework:managed>
${
  model.autos.length === 0
    ? '        // No autonomous routines configured.'
    : model.autos
        .map((auto) => {
          const command = model.commands.find((entry) => entry.id === auto.commandId);
          return `        chooser.addOption("${escapeJava(auto.displayName)}", ${command === undefined ? 'Commands.none()' : `commands.${command.symbol}()`});`;
        })
        .join('\n')
}
        // </frc-framework:managed>
    }
}
`;
}

function robotCommandsJava(model: FrcProjectModel): string {
  const requirements = commandRequirements(model);
  const symbolCounts = new Map<string, number>();
  for (const requirement of requirements)
    symbolCounts.set(requirement.symbol, (symbolCounts.get(requirement.symbol) ?? 0) + 1);
  const imports = requirements
    .filter((entry) => symbolCounts.get(entry.symbol) === 1)
    .map((entry) => {
      const location = subsystemJavaLocation(model, entry);
      return `import ${location.packageName}.${entry.symbol};`;
    });
  const typeName = (entry: Subsystem): string =>
    symbolCounts.get(entry.symbol) === 1
      ? entry.symbol
      : `${subsystemJavaLocation(model, entry).packageName}.${entry.symbol}`;
  const fieldName = (entry: Subsystem): string => compositionFieldName(model, entry);
  const commands = [...model.commands].sort((left, right) =>
    left.symbol.localeCompare(right.symbol),
  );
  return `package ${model.project.javaPackage}.commands;

import edu.wpi.first.wpilibj2.command.Command;
import edu.wpi.first.wpilibj2.command.Commands;
${imports.join('\n')}${imports.length === 0 ? '' : '\n'}
/** Factory methods for commands that coordinate one or more subsystems. */
public final class RobotCommands {
    // <frc-framework:managed>
${requirements.map((entry) => `    private final ${typeName(entry)} ${fieldName(entry)};`).join('\n')}${requirements.length === 0 ? '    // No subsystem dependencies configured.' : ''}

    public RobotCommands(${requirements.map((entry) => `${typeName(entry)} ${fieldName(entry)}`).join(', ')}) {
${requirements.map((entry) => `        this.${fieldName(entry)} = ${fieldName(entry)};`).join('\n')}${requirements.length === 0 ? '        // No dependencies.' : ''}
    }

    public void configureDefaults() {
        // Configure subsystem default commands here or through generated model extensions.
    }

${commands.map((command) => commandFactoryJava(model, command)).join('\n\n')}
    // </frc-framework:managed>
}
`;
}

function commandFactoryJava(
  model: FrcProjectModel,
  command: FrcProjectModel['commands'][number],
): string {
  const children = (command.childCommandIds ?? [])
    .map((id) => model.commands.find((entry) => entry.id === id))
    .filter((entry): entry is FrcProjectModel['commands'][number] => entry !== undefined);
  let expression: string;
  if (command.codeExpression !== undefined && command.codeExpression.trim().length > 0) {
    expression = command.codeExpression.trim();
  } else {
    const calls = children.map((child) => `${child.symbol}()`).join(', ');
    expression =
      command.kind === 'sequence'
        ? `Commands.sequence(${calls})`
        : command.kind === 'parallel'
          ? `Commands.parallel(${calls})`
          : command.kind === 'race'
            ? `Commands.race(${calls})`
            : command.kind === 'deadline' && children.length > 0
              ? `Commands.deadline(${children[0]?.symbol ?? 'none'}()${
                  children.length > 1
                    ? `, ${children
                        .slice(1)
                        .map((child) => `${child.symbol}()`)
                        .join(', ')}`
                    : ''
                })`
              : `Commands.none().withName("${escapeJava(command.displayName)}")`;
  }
  return `    public Command ${command.symbol}() {
        return ${expression};
    }`;
}

function commandRequirements(model: FrcProjectModel): readonly Subsystem[] {
  const ids = new Set(model.commands.flatMap((command) => command.requirementIds));
  const result = model.subsystems.filter((entry) => ids.has(entry.id));
  return dependencyOrder(result);
}

function dependencyOrder(input: readonly Subsystem[]): readonly Subsystem[] {
  const byId = new Map(input.map((entry) => [entry.id, entry]));
  const result: Subsystem[] = [];
  const visited = new Set<string>();
  const visit = (subsystem: Subsystem): void => {
    if (visited.has(subsystem.id)) return;
    visited.add(subsystem.id);
    for (const dependency of subsystem.dependencies ?? []) {
      const target = byId.get(dependency.targetSubsystemId);
      if (target !== undefined) visit(target);
    }
    result.push(subsystem);
  };
  [...input].sort((left, right) => left.symbol.localeCompare(right.symbol)).forEach(visit);
  return result;
}

function compositionOrder(model: FrcProjectModel): readonly Subsystem[] {
  const result: Subsystem[] = [];
  const completed = new Set<string>();
  const visiting = new Set<string>();
  const visit = (node: Subsystem): void => {
    if (completed.has(node.id)) return;
    if (visiting.has(node.id)) {
      throw new Error(
        `Subsystem composition contains a cycle at ${node.displayName}; remove a parent/dependency loop.`,
      );
    }
    visiting.add(node.id);
    for (const child of children(model, node.id)) visit(child);
    for (const dependency of node.dependencies ?? []) {
      const target = model.subsystems.find((entry) => entry.id === dependency.targetSubsystemId);
      if (target !== undefined) visit(target);
    }
    visiting.delete(node.id);
    completed.add(node.id);
    result.push(node);
  };
  for (const root of roots(model)) visit(root);
  for (const node of [...model.subsystems].sort((left, right) =>
    left.symbol.localeCompare(right.symbol),
  ))
    visit(node);
  return result;
}

function compositionFieldName(model: FrcProjectModel, node: Subsystem): string {
  if (model.subsystems.filter((entry) => entry.symbol === node.symbol).length === 1)
    return lowerFirst(node.symbol);
  const path: string[] = [node.symbol];
  let cursor = node;
  const visited = new Set<string>([node.id]);
  while (cursor.parentId !== undefined) {
    const parent = model.subsystems.find((entry) => entry.id === cursor.parentId);
    if (parent === undefined || visited.has(parent.id)) break;
    visited.add(parent.id);
    path.unshift(parent.symbol);
    cursor = parent;
  }
  return lowerFirst(path.join(''));
}

function hardwareMapDocument(model: FrcProjectModel): string {
  const rows = [...model.devices]
    .sort((left, right) => left.displayName.localeCompare(right.displayName))
    .map(
      (device) =>
        `| ${device.displayName} | ${device.vendor} ${device.model} | ${device.canId ?? '—'} | ${device.canBus ?? 'rio'} | ${parentPath(model, device.parentId)} | ${device.role ?? '—'} |`,
    );
  return `# Hardware Map

Generated from \`project.yaml\`. Add team-specific wiring notes only below the user supplement marker.

| Device | Type | CAN ID | Bus | Logical location | Purpose |
| --- | --- | ---: | --- | --- | --- |
${rows.length === 0 ? '| _No devices configured_ | — | — | — | — | — |' : rows.join('\n')}

<!-- frc-framework:user-supplement:start -->
<!-- Add wiring, breaker, connector, and physical-location notes here. -->
<!-- frc-framework:user-supplement:end -->
`;
}

function componentCatalogDocument(model: FrcProjectModel): string {
  const definitions = [
    ...new Map(
      model.devices
        .map((device) =>
          device.catalogId === undefined ? undefined : findComponentDefinition(device.catalogId),
        )
        .filter((entry) => entry !== undefined)
        .map((entry) => [entry.id, entry]),
    ).values(),
  ].sort((left, right) => left.displayName.localeCompare(right.displayName));
  const sections = definitions.map(
    (definition) => `## ${definition.displayName}

- Catalog ID: \`${definition.id}\`
- IronPulse real type: \`${definition.realClass}\`
- IronPulse simulation type: \`${definition.simClass}\`
- Role: ${definition.role}

${definition.description}

| Parameter | Category | Type | Unit | Default | Description |
| --- | --- | --- | --- | --- | --- |
${definition.parameters.map((parameter) => `| ${parameter.displayName} | ${parameter.category} | ${parameter.type} | ${parameter.unit ?? '—'} | \`${Array.isArray(parameter.defaultValue) ? parameter.defaultValue.join(', ') : String(parameter.defaultValue)}\` | ${parameter.description} |`).join('\n')}`,
  );
  return `# IronPulse Component Catalog

Only components currently used by this robot are listed. FRC Framework stores ordinary project data; these types remain readable without the application.

The compact compatibility API and motor parameter surface are maintained against the 2026 IronPulse code used by the 10541 offseason robot. It includes unit-based position/velocity aliases, remote CANcoder configuration, zero offset/filter settings, Motion Magic, live gain/current/limit updates, and explicit real/simulation IO while preserving FRC Framework's smaller standalone API.

${sections.length === 0 ? '_No catalog components are configured._' : sections.join('\n\n')}

<!-- frc-framework:user-supplement:start -->
<!-- Add team-specific component conventions here. -->
<!-- frc-framework:user-supplement:end -->
`;
}

function subsystemsDocument(model: FrcProjectModel): string {
  const lines = [...model.subsystems]
    .sort((left, right) => parentPath(model, left.id).localeCompare(parentPath(model, right.id)))
    .map((node) => {
      const depth = subsystemDepth(model, node);
      const location = subsystemJavaLocation(model, node);
      const presetConfig =
        node.symbol === 'SwerveSubsystem' &&
        model.presets.some((preset) => preset.presetId === 'frc.swerve')
          ? location.file.replace(/SwerveSubsystem\.java$/u, 'SwerveConfig.java')
          : undefined;
      const config =
        ownedMotors(model, node).length === 0 && presetConfig === undefined
          ? ''
          : `; hardware config: \`${presetConfig ?? location.file.replace(/\.java$/u, 'Config.java')}\``;
      const dependencies = (node.dependencies ?? [])
        .map(
          (dependency) =>
            model.subsystems.find((entry) => entry.id === dependency.targetSubsystemId)
              ?.displayName ?? dependency.targetSubsystemId,
        )
        .join(', ');
      return `${'  '.repeat(depth)}- ${node.kind}: **${node.displayName}** (\`${node.symbol}\`) — ${node.behaviorMode ?? 'direct'}; runtime: \`${location.file}\`${config}${dependencies.length === 0 ? '' : `; depends on ${dependencies}`}`;
    });
  return `# Subsystems

${lines.length === 0 ? '_No subsystems configured._' : lines.join('\n')}

<!-- frc-framework:user-supplement:start -->
<!-- Add subsystem behavior and maintenance notes here. -->
<!-- frc-framework:user-supplement:end -->
`;
}

function robotOverviewDocument(model: FrcProjectModel): string {
  return `# Robot Overview

**${model.project.displayName}** is a WPILib ${String(model.project.wpilibYear)} command-based robot project for FRC team ${String(model.project.teamNumber)}.

- Java package: \`${model.project.javaPackage}\`
- Subsystems/mechanisms: ${String(model.subsystems.length)}
- Devices: ${String(model.devices.length)}
- Controllers: ${String(model.controllers.length)}
- Commands: ${String(model.commands.length)}
- Autonomous routines: ${String(model.autos.length)}

See \`HARDWARE_MAP.md\`, \`SUBSYSTEMS.md\`, \`CONTROL_BINDINGS.md\`, and \`STATE_MODEL.md\` before changing robot behavior.

<!-- frc-framework:user-supplement:start -->
<!-- Add robot strategy, physical layout, and current operational notes here. -->
<!-- frc-framework:user-supplement:end -->
`;
}

function controlBindingsDocument(model: FrcProjectModel): string {
  const rows = model.bindings.map((binding) => {
    const controller = model.controllers.find((entry) => entry.id === binding.controllerId);
    const command = model.commands.find((entry) => entry.id === binding.commandId);
    return `| ${controller?.displayName ?? 'Unknown'} | \`${binding.input}\` | ${binding.behavior} | ${command?.displayName ?? binding.codeReference ?? 'Custom Java'} |`;
  });
  return `# Control Bindings

| Controller | Input | Trigger | Command / logic |
| --- | --- | --- | --- |
${rows.length === 0 ? '| _No bindings configured_ | — | — | — |' : rows.join('\n')}

Complex triggers remain ordinary Java and appear as source summaries in FRC Framework.

<!-- frc-framework:user-supplement:start -->
<!-- Add operator conventions and match-use notes here. -->
<!-- frc-framework:user-supplement:end -->
`;
}

function codeStyleDocument(): string {
  return `# Code Style

- Keep \`RobotContainer\` limited to construction and wiring.
- Put input bindings in \`controls/OperatorInterface\` and cross-subsystem composition in \`commands/RobotCommands\`.
- Keep hardware access behind explicit Real/Sim IO boundaries.
- Use Goals for requested subsystem behavior; derive Status from sensors; use Commands for scheduling.
- Do not edit \`<frc-framework:managed>\` regions without synchronizing \`project.yaml\`.
- Run \`./gradlew spotlessApply compileJava test\` before handoff.

<!-- frc-framework:user-supplement:start -->
<!-- Add team-specific naming and review rules here. -->
<!-- frc-framework:user-supplement:end -->
`;
}

function safetyDocument(model: FrcProjectModel): string {
  return `# Safety

This project targets FRC team ${String(model.project.teamNumber)}. Treat deploy, calibration, SysId, and direct motor tests as real-robot operations.

- Put the robot on blocks before checking drivetrain direction or offsets.
- Keep an operator at the enable/disable control and provide a clear emergency stop path.
- Start direction tests at low output with an automatic timeout.
- Confirm CAN IDs, current limits, soft limits, zero/home behavior, and mechanism clearance.
- Validate simulation and compile before deployment; never silently deploy after a tuning write-back.

<!-- frc-framework:user-supplement:start -->
<!-- Add team lockout, pit, and mechanism-specific safety procedures here. -->
<!-- frc-framework:user-supplement:end -->
`;
}

function tuningDocument(model: FrcProjectModel): string {
  const parameters = collectTuningParameters(model);
  const history = model.tuningHistory
    .slice(-20)
    .reverse()
    .map(
      (entry) =>
        `| ${entry.writtenAt} | ${entry.source} | ${entry.changes.map((change) => `${change.path}: \`${String(change.oldValue)}\` → \`${String(change.newValue)}\``).join('<br>')} |`,
    );
  const snapshots = model.tuningSnapshots.map(
    (entry) =>
      `| ${entry.name} | ${entry.capturedAt} | ${String(Object.keys(entry.values).length)} |`,
  );
  return `# Tuning

NetworkTables root: \`${model.networkTables.rootPath}\`<br>
Live tuning enabled: ${String(model.networkTables.enabled)}

| Parameter | Code default | Unit | Type | Path | Access |
| --- | --- | --- | --- | --- | --- |
${parameters.length === 0 ? '| _No parameters published_ | — | — | — | — | — |' : parameters.map((entry) => `| ${entry.subsystemName} / ${entry.mechanismName} / ${entry.displayName} | \`${Array.isArray(entry.codeValue) ? entry.codeValue.join(', ') : String(entry.codeValue)}\` | ${entry.unit ?? '—'} | ${entry.type} | \`${entry.path}\` | ${entry.writable ? 'tunable' : 'read-only'} |`).join('\n')}

FRC Framework compares live values with code defaults. Writing NT values to code creates a reviewed batch Diff; it does not deploy automatically.

## Write-back history

| Time | Source | Changes |
| --- | --- | --- |
${history.length === 0 ? '| _No write-backs recorded_ | — | — |' : history.join('\n')}

## Named snapshots

| Name | Captured | Values |
| --- | --- | ---: |
${snapshots.length === 0 ? '| _No snapshots saved_ | — | — |' : snapshots.join('\n')}

<!-- frc-framework:user-supplement:start -->
<!-- Add tested gains, mechanism setup, and tuning procedure notes here. -->
<!-- frc-framework:user-supplement:end -->
`;
}

function telemetryDocument(model: FrcProjectModel): string {
  return `# Telemetry

Runtime publication is centralized under \`${model.project.javaPackage}.telemetry\`.

- Robot state recorder: ${model.robot.telemetry?.stateRecorder === false ? 'disabled' : 'enabled'}
- Field2d publisher: ${model.robot.telemetry?.fieldPublisher === false ? 'disabled' : 'enabled'}
- AdvantageKit keys: \`Robot/Enabled\`, lifecycle mode, alliance, battery voltage, brownout, DS connection, and match time

\`RobotTelemetry\` is called from \`RobotContainer.periodic()\`. \`FieldPublisher\` accepts robot and named-object poses without making subsystems depend on SmartDashboard. Team-specific logging may be added outside managed Java regions.

<!-- frc-framework:user-supplement:start -->
<!-- Add dashboard layout, pose source, and event-recording notes here. -->
<!-- frc-framework:user-supplement:end -->
`;
}

function calibrationDocument(model: FrcProjectModel): string {
  const motors = model.devices.filter((device) => device.kind === 'motor');
  return `# Calibration and safe bring-up

FRC Framework exposes guarded requests under \`/FRCFramework/Calibration\`. The generated \`RobotCalibration\` accepts motor tests only while the Driver Station is **Test Enabled**, clamps duty cycle to 15%, and stops within two seconds even if the desktop app disconnects.

## Motor device IDs

${motors.length === 0 ? '_No motors configured._' : motors.map((device) => `- ${device.displayName}: \`${device.id}\``).join('\n')}

## Recommended checks

1. Verify Swerve CANcoder offsets and drive/steer directions with the robot raised safely.
2. Verify Pigeon roll/pitch/yaw mount orientation before field-relative control.
3. Establish mechanism home/zero and confirm both soft and physical limits.
4. Measure Limelight transforms from the robot coordinate origin.
5. Use WPILib SysId only in a controlled area; result logs are written to the roboRIO/desktop WPILib DataLog location and can be opened with AdvantageScope.

All saved offset, mount, limit, and transform values return through a normal project model command and reviewed Diff.

<!-- frc-framework:user-supplement:start -->
<!-- Record completed checks, fixture setup, safe power, and result file locations here. -->
<!-- frc-framework:user-supplement:end -->
`;
}

function simulationDocument(): string {
  return `# Simulation inputs

Run \`./gradlew simulateJava\` or use the Toolchain page. The generated \`simgui-ds.json\` provides two keyboard joysticks:

- Keyboard 0 axes: A/D, W/S, Q/E; buttons: Space, Z, X, C.
- Keyboard 1 axes: J/L, I/K; buttons: M, comma, period, slash.

Drag the keyboard joystick into the desired robot joystick slot in WPILib SimGUI. Its NetworkTables panel can inspect values, while FRC Framework's NT page can connect to \`127.0.0.1\` for typed inputs and reviewed tuning write-back.

Controller provider and USB port assignments remain defined in \`project.yaml\`; keyboard simulation does not change real Driver Station mappings.
`;
}

function stateModelDocument(model: FrcProjectModel): string {
  const sections = model.subsystems
    .filter((entry) => entry.stateMachine !== undefined)
    .map(
      (entry) =>
        `## ${parentPath(model, entry.id)}\n\nSource: \`${subsystemJavaLocation(model, entry).file}\`\n\nGoals: ${entry.stateMachine?.states.map((state) => `\`${state.symbol}\``).join(', ') || '_none_'}\n\nA Goal is requested behavior; sensor-derived Status should remain ordinary Java and Commands perform transitions or coordination.`,
    );
  return `# State Model

${sections.length === 0 ? '_No goal-driven subsystems configured._' : sections.join('\n\n')}

<!-- frc-framework:user-supplement:start -->
<!-- Add robot-wide coordination and safety-state notes here. -->
<!-- frc-framework:user-supplement:end -->
`;
}

function parentPath(model: FrcProjectModel, parentId: string): string {
  const parts: string[] = [];
  let cursor = model.subsystems.find((entry) => entry.id === parentId);
  while (cursor !== undefined) {
    parts.unshift(cursor.displayName);
    cursor =
      cursor.parentId === undefined
        ? undefined
        : model.subsystems.find((entry) => entry.id === cursor?.parentId);
  }
  return parts.join(' / ');
}

function subsystemDepth(model: FrcProjectModel, subsystem: Subsystem): number {
  let depth = 0;
  let cursor = subsystem;
  const visited = new Set<string>();
  while (cursor.parentId !== undefined && !visited.has(cursor.id)) {
    visited.add(cursor.id);
    const parent = model.subsystems.find((entry) => entry.id === cursor.parentId);
    if (parent === undefined) break;
    depth += 1;
    cursor = parent;
  }
  return depth;
}

function parameter(device: Device, key: string): DeviceParameter | undefined {
  return device.parameters.find((entry) => entry.key === key);
}

function numberParameter(device: Device, key: string, fallback: number): number {
  const value = parameter(device, key)?.value;
  return typeof value === 'number' ? value : fallback;
}

function stringParameter(device: Device, key: string): string | undefined {
  const value = parameter(device, key)?.value;
  return typeof value === 'string' ? value : undefined;
}

function booleanParameter(device: Device, key: string): boolean {
  return parameter(device, key)?.value === true;
}

function javaNumber(value: number): string {
  if (Number.isNaN(value)) return 'Double.NaN';
  if (value === Number.POSITIVE_INFINITY) return 'Double.POSITIVE_INFINITY';
  if (value === Number.NEGATIVE_INFINITY) return 'Double.NEGATIVE_INFINITY';
  return Number.isInteger(value) ? `${String(value)}.0` : String(value);
}

function camelToUpperSnake(value: string): string {
  return value
    .replace(/([a-z\d])([A-Z])/gu, '$1_$2')
    .replace(/[^A-Za-z\d]+/gu, '_')
    .toUpperCase();
}

function lowerFirst(value: string): string {
  return `${value.slice(0, 1).toLowerCase()}${value.slice(1)}`;
}

function escapeJava(value: string): string {
  return value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
}

function escapeJavadoc(value: string): string {
  return value.replace(/\*\//gu, '* /').replace(/[\r\n]+/gu, ' ');
}
