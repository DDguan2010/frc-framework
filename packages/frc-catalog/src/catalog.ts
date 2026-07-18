import type {
  Device,
  DeviceParameter,
  EntityId,
  ParameterCondition,
  ParameterType,
  ParameterValue,
} from '@frc-framework/domain';
import { createEntityId, javaSymbol } from '@frc-framework/domain';

export const CATALOG_VERSION = 1 as const;

export type CatalogCategory =
  | 'identity'
  | 'electrical'
  | 'feedback'
  | 'control'
  | 'limits'
  | 'motion'
  | 'simulation'
  | 'telemetry';

export interface GeneratorMapping {
  readonly javaPath: string;
  readonly javaMethod?: string;
  readonly omissionDefault?: ParameterValue;
}

export interface CatalogParameterDefinition {
  readonly key: string;
  readonly displayName: string;
  readonly description: string;
  readonly category: CatalogCategory;
  readonly type: ParameterType;
  readonly defaultValue: ParameterValue;
  readonly required?: boolean;
  readonly common?: boolean;
  readonly unit?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly enumValues?: readonly string[];
  readonly condition?: ParameterCondition;
  readonly mutuallyExclusiveWith?: readonly string[];
  readonly tunable?: boolean;
  readonly mapping: GeneratorMapping;
}

export interface ComponentDefinition {
  readonly id: string;
  readonly version: number;
  readonly displayName: string;
  readonly description: string;
  readonly documentationUrl: string;
  readonly domainKind: Device['kind'];
  readonly vendor: string;
  readonly model: string;
  readonly role: 'device' | 'follower' | 'mechanism';
  readonly realClass: string;
  readonly simClass: string;
  readonly parameters: readonly CatalogParameterDefinition[];
}

const parameter = (
  key: string,
  displayName: string,
  category: CatalogCategory,
  type: ParameterType,
  defaultValue: ParameterValue,
  mapping: string,
  options: Omit<
    CatalogParameterDefinition,
    'category' | 'defaultValue' | 'description' | 'displayName' | 'key' | 'mapping' | 'type'
  > & { readonly description?: string } = {},
): CatalogParameterDefinition => ({
  category,
  defaultValue,
  description: options.description ?? parameterDescription(key, displayName, category),
  displayName,
  key,
  mapping: { javaPath: mapping, omissionDefault: defaultValue },
  type,
  ...options,
});

const PARAMETER_DESCRIPTIONS: Readonly<Record<string, string>> = {
  channel: 'Hardware port or channel used by this device.',
  closedLoopRamp: 'Time used to ramp a closed-loop request from zero to full output.',
  continuousWrap: 'Uses the shortest path across the wrap boundary for rotating mechanisms.',
  feedbackSource: 'Selects the sensor source used by the motor controller closed loop.',
  forwardSoftLimit: 'Maximum allowed mechanism position before forward output is blocked.',
  forwardSoftLimitEnabled: 'Enables software protection at the configured forward position.',
  gravityType: 'Selects the gravity feedforward model for an elevator or rotating arm.',
  inversion: 'Defines which motor rotation is treated as the positive mechanism direction.',
  inverted: 'Reverses the interpreted sensor or output state.',
  leaderId: 'Entity ID of the primary motor followed by this controller.',
  length: 'Number of addressable LEDs connected to the output.',
  magnetOffset: 'Absolute encoder offset applied when the mechanism is at its known reference.',
  motionMagicAcceleration: 'Maximum acceleration used by the Motion Magic profile.',
  motionMagicJerk: 'Maximum rate of acceleration change used by the Motion Magic profile.',
  motionMagicVelocity: 'Maximum cruise velocity used by the Motion Magic profile.',
  neutralMode: 'Chooses brake holding or coast behavior when motor output is zero.',
  openLoopRamp: 'Time used to ramp an open-loop request from zero to full output.',
  opposeLeader: 'Runs this follower in the opposite direction from its leader.',
  portType: 'Selects whether the sensor uses DIO, analog, PWM, or another supported port type.',
  remoteEncoderEnabled: 'Uses an external CANcoder instead of only the integrated rotor sensor.',
  remoteEncoderId: 'CAN ID of the remote encoder used for closed-loop feedback.',
  reverseSoftLimit: 'Minimum allowed mechanism position before reverse output is blocked.',
  reverseSoftLimitEnabled: 'Enables software protection at the configured reverse position.',
  rotorToSensorRatio: 'Motor rotor rotations per one remote-sensor rotation.',
  sensorDirection: 'Defines which absolute-encoder rotation is reported as positive.',
  sensorToMechanismRatio:
    'Sensor rotations per one mechanism rotation; converts sensor units to mechanism units.',
  setpoints: 'Named mechanism targets such as HOME=0 or SPEAKER=85.',
  setpointUnit: 'Physical unit used by named setpoints and at-goal comparisons.',
  simFrictionVoltage: 'Simulated voltage required to overcome static mechanism friction.',
  simGearRatio: 'Gear reduction used by the physics simulation model.',
  simInertia: 'Simulated mechanism moment of inertia used for acceleration response.',
  simMaximum: 'Maximum simulated mechanism position.',
  simMinimum: 'Minimum simulated mechanism position.',
  statorCurrentLimit: 'Limits motor winding current to protect the motor and mechanism.',
  supplyCurrentLimit: 'Limits battery-side current drawn by the motor controller.',
  threshold: 'Sensor voltage boundary used to switch between clear and detected states.',
  tolerance: 'Maximum permitted error for reporting that the mechanism is at its goal.',
  zeroingCurrent:
    'Current threshold that indicates the mechanism has reached its hard stop while homing.',
  zeroingVoltage: 'Low voltage applied while moving toward the mechanism home reference.',
};

function parameterDescription(key: string, displayName: string, category: CatalogCategory): string {
  if (/^k[PIDSVGAF]$/u.test(key)) {
    return `${key} closed-loop gain. Tune this value carefully while monitoring mechanism response.`;
  }
  if (/^mount(?:Roll|Pitch|Yaw)$/u.test(key)) {
    return `${displayName} of the sensor relative to the robot coordinate frame, in degrees.`;
  }
  return (
    PARAMETER_DESCRIPTIONS[key] ??
    `${displayName} controls this device's ${category} configuration.`
  );
}

const motorParameters: readonly CatalogParameterDefinition[] = [
  parameter(
    'inversion',
    'Inversion',
    'electrical',
    'enum',
    'counterClockwisePositive',
    'inverted',
    {
      common: true,
      enumValues: ['counterClockwisePositive', 'clockwisePositive'],
    },
  ),
  parameter('neutralMode', 'Neutral mode', 'electrical', 'enum', 'brake', 'brake', {
    common: true,
    enumValues: ['brake', 'coast'],
  }),
  parameter(
    'statorCurrentLimit',
    'Stator current limit',
    'electrical',
    'number',
    80,
    'currentLimits.stator',
    {
      common: true,
      maximum: 800,
      minimum: 0,
      tunable: true,
      unit: 'A',
    },
  ),
  parameter(
    'supplyCurrentLimit',
    'Supply current limit',
    'electrical',
    'number',
    40,
    'currentLimits.supply',
    {
      common: true,
      maximum: 800,
      minimum: 0,
      tunable: true,
      unit: 'A',
    },
  ),
  parameter('openLoopRamp', 'Open-loop ramp', 'electrical', 'number', 0, 'openLoopRamp', {
    maximum: 10,
    minimum: 0,
    tunable: true,
    unit: 's',
  }),
  parameter('closedLoopRamp', 'Closed-loop ramp', 'electrical', 'number', 0, 'closedLoopRamp', {
    maximum: 10,
    minimum: 0,
    tunable: true,
    unit: 's',
  }),
  parameter(
    'sensorToMechanismRatio',
    'Sensor/mechanism ratio',
    'feedback',
    'number',
    1,
    'sensorToMechanismRatio',
    {
      common: true,
      minimum: 0.000_001,
    },
  ),
  parameter(
    'rotorToSensorRatio',
    'Rotor/sensor ratio',
    'feedback',
    'number',
    1,
    'remoteEncoder.rotorToSensorRatio',
    {
      condition: { equals: true, parameter: 'remoteEncoderEnabled' },
      minimum: 0.000_001,
    },
  ),
  parameter(
    'remoteEncoderEnabled',
    'Remote CANcoder',
    'feedback',
    'boolean',
    false,
    'remoteEncoder.enabled',
    {
      common: true,
    },
  ),
  parameter('remoteEncoderId', 'Remote CANcoder ID', 'feedback', 'number', 0, 'remoteEncoder.id', {
    condition: { equals: true, parameter: 'remoteEncoderEnabled' },
    maximum: 62,
    minimum: 0,
  }),
  parameter(
    'feedbackSource',
    'Feedback source',
    'feedback',
    'enum',
    'fusedCANcoder',
    'remoteEncoder.source',
    {
      condition: { equals: true, parameter: 'remoteEncoderEnabled' },
      enumValues: ['remoteCANcoder', 'syncCANcoder', 'fusedCANcoder'],
    },
  ),
  parameter('continuousWrap', 'Continuous wrap', 'feedback', 'boolean', false, 'continuousWrap'),
  ...['kP', 'kI', 'kD', 'kS', 'kV', 'kA', 'kG'].map((key) =>
    parameter(key, key, 'control', 'number', 0, `gains.${key}`, {
      common: key === 'kP' || key === 'kD',
      tunable: true,
    }),
  ),
  parameter('gravityType', 'Gravity type', 'control', 'enum', 'elevatorStatic', 'gravityType', {
    enumValues: ['elevatorStatic', 'armCosine'],
  }),
  parameter(
    'forwardSoftLimitEnabled',
    'Forward soft limit',
    'limits',
    'boolean',
    false,
    'softLimits.forwardEnabled',
  ),
  parameter('forwardSoftLimit', 'Forward limit', 'limits', 'number', 0, 'softLimits.forward', {
    condition: { equals: true, parameter: 'forwardSoftLimitEnabled' },
    tunable: true,
    unit: 'rot',
  }),
  parameter(
    'reverseSoftLimitEnabled',
    'Reverse soft limit',
    'limits',
    'boolean',
    false,
    'softLimits.reverseEnabled',
  ),
  parameter('reverseSoftLimit', 'Reverse limit', 'limits', 'number', 0, 'softLimits.reverse', {
    condition: { equals: true, parameter: 'reverseSoftLimitEnabled' },
    tunable: true,
    unit: 'rot',
  }),
  parameter('zeroingVoltage', 'Zeroing voltage', 'limits', 'number', -2, 'zeroing.voltage', {
    maximum: 12,
    minimum: -12,
    tunable: true,
    unit: 'V',
  }),
  parameter('zeroingCurrent', 'Zeroing current', 'limits', 'number', 40, 'zeroing.current', {
    maximum: 800,
    minimum: 0,
    tunable: true,
    unit: 'A',
  }),
  parameter(
    'motionMagicVelocity',
    'Motion Magic velocity',
    'motion',
    'number',
    0,
    'motionMagic.velocity',
    {
      minimum: 0,
      tunable: true,
      unit: 'rot/s',
    },
  ),
  parameter(
    'motionMagicAcceleration',
    'Motion Magic acceleration',
    'motion',
    'number',
    0,
    'motionMagic.acceleration',
    {
      minimum: 0,
      tunable: true,
      unit: 'rot/s²',
    },
  ),
  parameter('motionMagicJerk', 'Motion Magic jerk', 'motion', 'number', 0, 'motionMagic.jerk', {
    minimum: 0,
    tunable: true,
    unit: 'rot/s³',
  }),
  parameter('tolerance', 'At-goal tolerance', 'control', 'number', 0.01, 'tolerance', {
    minimum: 0,
    tunable: true,
  }),
  parameter('simGearRatio', 'Simulation gearing', 'simulation', 'number', 1, 'simulation.gearing', {
    common: true,
    minimum: 0.000_001,
  }),
  parameter(
    'simInertia',
    'Simulation inertia',
    'simulation',
    'number',
    0.001,
    'simulation.inertia',
    {
      common: true,
      minimum: 0.000_001,
      unit: 'kg·m²',
    },
  ),
  parameter(
    'simFrictionVoltage',
    'Simulation friction',
    'simulation',
    'number',
    0,
    'simulation.frictionVoltage',
    {
      maximum: 12,
      minimum: 0,
      unit: 'V',
    },
  ),
  parameter(
    'simMinimum',
    'Simulation lower bound',
    'simulation',
    'number',
    0,
    'simulation.minimum',
  ),
  parameter(
    'simMaximum',
    'Simulation upper bound',
    'simulation',
    'number',
    1,
    'simulation.maximum',
  ),
];

const definitions: readonly ComponentDefinition[] = [
  {
    description: 'TalonFX primary motor using the IronPulse MotorIO Real/Sim boundary.',
    displayName: 'TalonFX primary motor',
    documentationUrl: 'docs/COMPONENT_CATALOG.md#talonfx-primary-motor',
    domainKind: 'motor',
    id: 'ironpulse.talonfx-primary',
    model: 'TalonFX',
    parameters: motorParameters,
    realClass: 'lib.ironpulse.io.MotorIOTalonFX',
    role: 'device',
    simClass: 'lib.ironpulse.io.MotorIOSim',
    vendor: 'CTRE',
    version: CATALOG_VERSION,
  },
  {
    description: 'Follower TalonFX associated with a primary motor.',
    displayName: 'TalonFX follower',
    documentationUrl: 'docs/COMPONENT_CATALOG.md#talonfx-follower',
    domainKind: 'motor',
    id: 'ironpulse.talonfx-follower',
    model: 'TalonFX Follower',
    parameters: [
      parameter('leaderId', 'Leader entity', 'identity', 'string', '', 'follower.leaderId', {
        required: true,
      }),
      parameter(
        'opposeLeader',
        'Oppose leader',
        'electrical',
        'boolean',
        false,
        'follower.opposeLeader',
        { common: true },
      ),
      ...motorParameters.filter((entry) =>
        ['statorCurrentLimit', 'supplyCurrentLimit', 'openLoopRamp'].includes(entry.key),
      ),
    ],
    realClass: 'lib.ironpulse.io.MotorIOTalonFX.Follower',
    role: 'follower',
    simClass: 'lib.ironpulse.io.MotorIOSim.Follower',
    vendor: 'CTRE',
    version: CATALOG_VERSION,
  },
  {
    description: 'Position goal mechanism built on MotorSubsystem.',
    displayName: 'Position motor mechanism',
    documentationUrl: 'docs/COMPONENT_CATALOG.md#position-mechanism',
    domainKind: 'custom',
    id: 'ironpulse.position-mechanism',
    model: 'PositionMotorSubsystem',
    parameters: [
      parameter('setpoints', 'Named setpoints', 'control', 'string[]', [], 'position.setpoints', {
        common: true,
      }),
      parameter('setpointUnit', 'Setpoint unit', 'control', 'enum', 'rot', 'position.unit', {
        common: true,
        enumValues: ['rot', 'deg', 'rad', 'm'],
      }),
      parameter('tolerance', 'At-goal tolerance', 'control', 'number', 0.01, 'position.tolerance', {
        minimum: 0,
        tunable: true,
      }),
    ],
    realClass: 'lib.ironpulse.subsystem.position.PositionMotorSubsystem',
    role: 'mechanism',
    simClass: 'lib.ironpulse.subsystem.position.PositionMotorSubsystem',
    vendor: 'IronPulse',
    version: CATALOG_VERSION,
  },
  {
    description: 'Velocity goal mechanism built on MotorSubsystem.',
    displayName: 'Velocity motor mechanism',
    documentationUrl: 'docs/COMPONENT_CATALOG.md#velocity-mechanism',
    domainKind: 'custom',
    id: 'ironpulse.velocity-mechanism',
    model: 'VelocityMotorSubsystem',
    parameters: [
      parameter('setpoints', 'Named setpoints', 'control', 'string[]', [], 'velocity.setpoints', {
        common: true,
      }),
      parameter('setpointUnit', 'Setpoint unit', 'control', 'enum', 'rps', 'velocity.unit', {
        common: true,
        enumValues: ['rps', 'rpm', 'm/s'],
      }),
      parameter('tolerance', 'At-goal tolerance', 'control', 'number', 1, 'velocity.tolerance', {
        minimum: 0,
        tunable: true,
      }),
    ],
    realClass: 'lib.ironpulse.subsystem.velocity.VelocityMotorSubsystem',
    role: 'mechanism',
    simClass: 'lib.ironpulse.subsystem.velocity.VelocityMotorSubsystem',
    vendor: 'IronPulse',
    version: CATALOG_VERSION,
  },
  {
    description: 'Phoenix 6 absolute CAN encoder with simulation fallback.',
    displayName: 'CANcoder',
    documentationUrl: 'docs/COMPONENT_CATALOG.md#cancoder',
    domainKind: 'encoder',
    id: 'ironpulse.cancoder',
    model: 'CANcoder',
    parameters: [
      parameter('magnetOffset', 'Magnet offset', 'feedback', 'number', 0, 'magnetOffset', {
        maximum: 0.5,
        minimum: -0.5,
        tunable: true,
        unit: 'rot',
      }),
      parameter(
        'sensorDirection',
        'Sensor direction',
        'feedback',
        'enum',
        'counterClockwisePositive',
        'sensorDirection',
        {
          enumValues: ['counterClockwisePositive', 'clockwisePositive'],
        },
      ),
    ],
    realClass: 'lib.ironpulse.io.CANCoderIOCANCoder',
    role: 'device',
    simClass: 'lib.ironpulse.io.CANCoderIOSim',
    vendor: 'CTRE',
    version: CATALOG_VERSION,
  },
  {
    description: 'Pigeon2 IMU with explicit mount orientation.',
    displayName: 'Pigeon2 gyro',
    documentationUrl: 'docs/COMPONENT_CATALOG.md#pigeon2',
    domainKind: 'gyro',
    id: 'ironpulse.pigeon2',
    model: 'Pigeon2',
    parameters: ['mountRoll', 'mountPitch', 'mountYaw'].map((key) =>
      parameter(key, key, 'feedback', 'number', 0, key, {
        maximum: 180,
        minimum: -180,
        unit: 'deg',
      }),
    ),
    realClass: 'lib.ironpulse.swerve.mk5n.ImuIOPigeon',
    role: 'device',
    simClass: 'lib.ironpulse.swerve.sim.ImuIOSim',
    vendor: 'CTRE',
    version: CATALOG_VERSION,
  },
  {
    description: 'Analog beam break input with a voltage threshold.',
    displayName: 'Beam break',
    documentationUrl: 'docs/COMPONENT_CATALOG.md#beam-break',
    domainKind: 'sensor',
    id: 'ironpulse.beam-break',
    model: 'Analog Beam Break',
    parameters: [
      parameter('portType', 'Port type', 'identity', 'enum', 'analog', 'port.type', {
        enumValues: ['analog', 'dio'],
      }),
      parameter('channel', 'Channel', 'identity', 'number', 0, 'port.channel', {
        common: true,
        maximum: 31,
        minimum: 0,
        required: true,
      }),
      parameter('threshold', 'Voltage threshold', 'feedback', 'number', 2.5, 'threshold', {
        maximum: 5,
        minimum: 0,
        tunable: true,
        unit: 'V',
      }),
      parameter('inverted', 'Inverted', 'feedback', 'boolean', false, 'inverted'),
    ],
    realClass: 'lib.ironpulse.io.BeamBreakIOAnalog',
    role: 'device',
    simClass: 'lib.ironpulse.io.BeamBreakIOSim',
    vendor: 'IronPulse',
    version: CATALOG_VERSION,
  },
  {
    description: 'Addressable LED indicator output with simulation fallback.',
    displayName: 'LED indicator',
    documentationUrl: 'docs/COMPONENT_CATALOG.md#led-indicator',
    domainKind: 'custom',
    id: 'ironpulse.indicator',
    model: 'Addressable LED',
    parameters: [
      parameter('channel', 'PWM channel', 'identity', 'number', 0, 'port.channel', {
        common: true,
        maximum: 19,
        minimum: 0,
        required: true,
      }),
      parameter('length', 'LED count', 'identity', 'number', 60, 'length', {
        common: true,
        maximum: 2048,
        minimum: 1,
      }),
    ],
    realClass: 'lib.ironpulse.indicator.IndicatorIOARGB',
    role: 'device',
    simClass: 'lib.ironpulse.indicator.IndicatorIOSim',
    vendor: 'IronPulse',
    version: CATALOG_VERSION,
  },
];

export const COMPONENT_CATALOG: readonly ComponentDefinition[] = definitions;

export function findComponentDefinition(id: string): ComponentDefinition | undefined {
  return COMPONENT_CATALOG.find((definition) => definition.id === id);
}

export function instantiateCatalogDevice(input: {
  readonly componentId: string;
  readonly parentId: EntityId;
  readonly displayName: string;
  readonly canId?: number;
  readonly canBus?: string;
  readonly selectedParameters?: readonly string[];
  readonly values?: Readonly<Record<string, ParameterValue>>;
  readonly publishToNetworkTables?: readonly string[];
}): Device {
  const definition = findComponentDefinition(input.componentId);
  if (definition === undefined) throw new Error(`Unknown component: ${input.componentId}`);
  const selected = new Set(input.selectedParameters ?? []);
  const published = new Set(input.publishToNetworkTables ?? []);
  const parameters: DeviceParameter[] = definition.parameters
    .filter((entry) => entry.required === true || entry.common === true || selected.has(entry.key))
    .map((entry) => ({
      ...(entry.condition === undefined ? {} : { condition: entry.condition }),
      ...(entry.enumValues === undefined ? {} : { enumValues: entry.enumValues }),
      ...(entry.maximum === undefined ? {} : { maximum: entry.maximum }),
      ...(entry.minimum === undefined ? {} : { minimum: entry.minimum }),
      ...(entry.unit === undefined ? {} : { unit: entry.unit }),
      defaultValue: entry.defaultValue,
      description: entry.description,
      displayName: entry.displayName,
      id: createEntityId(),
      key: entry.key,
      networkTables: {
        enabled: input.publishToNetworkTables === undefined || published.has(entry.key),
        writable: true,
      },
      source: input.values?.[entry.key] === undefined ? 'default' : 'user',
      type: entry.type,
      value: input.values?.[entry.key] ?? entry.defaultValue,
    }));
  return {
    ...(input.canBus === undefined ? {} : { canBus: input.canBus }),
    ...(input.canId === undefined ? {} : { canId: input.canId }),
    displayName: input.displayName,
    id: createEntityId(),
    kind: definition.domainKind,
    catalogId: definition.id,
    model: definition.model,
    parameters,
    parentId: input.parentId,
    symbol: javaSymbol(input.displayName),
    vendor: definition.vendor,
  };
}
