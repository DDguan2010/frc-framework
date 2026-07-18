import type {
  Device,
  DeviceParameter,
  FrcProjectModel,
  ParameterValue,
  PresetInstance,
  Subsystem,
} from '@frc-framework/domain';
import { javaSymbol } from '@frc-framework/domain';
import { instantiateCatalogDevice } from '@frc-framework/frc-catalog';

import { stablePresetEntityId } from './stable-id.js';

export interface SwervePresetConfiguration {
  readonly name?: string;
  readonly wheelbase: number;
  readonly trackwidth: number;
  readonly wheelRadius: number;
  readonly maxSpeed: number;
  readonly driveRatio: number;
  readonly steerRatio: number;
  readonly canBus: string;
  readonly gyroId: number;
  readonly driveIds: readonly [number, number, number, number];
  readonly steerIds: readonly [number, number, number, number];
  readonly encoderIds: readonly [number, number, number, number];
  readonly encoderOffsets: readonly [number, number, number, number];
  readonly driveInverted?: boolean;
  readonly steerInverted?: boolean;
  readonly driveKP?: number;
  readonly driveKV?: number;
  readonly steerKP?: number;
  readonly steerKD?: number;
  readonly statorCurrentLimit?: number;
  readonly supplyCurrentLimit?: number;
  readonly gyroMount?: readonly [number, number, number];
  readonly pathTranslationKP?: number;
  readonly pathRotationKP?: number;
}

export interface LimelightPresetConfiguration {
  readonly name?: string;
  readonly deviceName?: string;
  readonly table: string;
  readonly pipeline: number;
  readonly streamMode?: number;
  readonly transform: readonly [number, number, number, number, number, number];
}

export type CommonPresetId =
  | 'frc.percent-output'
  | 'frc.velocity-flywheel'
  | 'frc.position-mechanism'
  | 'frc.beambreak-indexer'
  | 'frc.led-indicator';

export interface CommonPresetConfiguration {
  readonly name: string;
  /** Optional subsystem/mechanism that will own the generated preset root. */
  readonly parentId?: string;
  readonly canBus?: string;
  readonly canId?: number;
  readonly followerIds?: readonly number[];
  readonly channel?: number;
  readonly setpoints?: readonly string[];
  readonly setpointUnit?: string;
}

export function instantiateSwervePreset(
  model: FrcProjectModel,
  config: SwervePresetConfiguration,
): FrcProjectModel {
  validateSwerve(config);
  ensurePresetMissing(model, 'frc.swerve');
  const displayName = config.name ?? 'Swerve';
  const rootId = stableId(`${model.project.id}:preset:swerve`);
  const root: Subsystem = {
    behaviorMode: 'direct',
    displayName,
    id: rootId,
    javaFile: `src/main/java/${model.project.javaPackage.replace(/\./gu, '/')}/subsystems/swerve/SwerveSubsystem.java`,
    javaPackage: `${model.project.javaPackage}.subsystems.swerve`,
    kind: 'subsystem',
    realImplementation: true,
    simulationImplementation: true,
    symbol: 'SwerveSubsystem',
  };
  const moduleNames = ['Front Left', 'Front Right', 'Back Left', 'Back Right'] as const;
  const mechanisms: Subsystem[] = moduleNames.map((name, index) => ({
    displayName: name,
    id: stableId(`${rootId}:module:${String(index)}`),
    kind: 'mechanism',
    parentId: rootId,
    symbol: name.replaceAll(' ', ''),
  }));
  const devices: Device[] = [];
  const driveParameters = [
    'sensorToMechanismRatio',
    'inversion',
    'kP',
    'kV',
    'statorCurrentLimit',
    'supplyCurrentLimit',
  ];
  const steerParameters = [
    'sensorToMechanismRatio',
    'continuousWrap',
    'inversion',
    'kP',
    'kD',
    'statorCurrentLimit',
    'supplyCurrentLimit',
  ];
  for (const [index, mechanism] of mechanisms.entries()) {
    const drive = instantiateCatalogDevice({
      canBus: config.canBus,
      canId: config.driveIds[index] ?? 0,
      componentId: 'ironpulse.talonfx-primary',
      displayName: `${moduleNames[index] ?? 'Module'} Drive`,
      parentId: mechanism.id,
      selectedParameters: driveParameters,
      values: {
        inversion: config.driveInverted === true ? 'clockwisePositive' : 'counterClockwisePositive',
        kP: config.driveKP ?? 0,
        kV: config.driveKV ?? 0,
        sensorToMechanismRatio: config.driveRatio,
        statorCurrentLimit: config.statorCurrentLimit ?? 80,
        supplyCurrentLimit: config.supplyCurrentLimit ?? 40,
      },
    });
    const steer = instantiateCatalogDevice({
      canBus: config.canBus,
      canId: config.steerIds[index] ?? 0,
      componentId: 'ironpulse.talonfx-primary',
      displayName: `${moduleNames[index] ?? 'Module'} Steer`,
      parentId: mechanism.id,
      selectedParameters: steerParameters,
      values: {
        continuousWrap: true,
        inversion: config.steerInverted === true ? 'clockwisePositive' : 'counterClockwisePositive',
        kD: config.steerKD ?? 0,
        kP: config.steerKP ?? 0,
        sensorToMechanismRatio: config.steerRatio,
        statorCurrentLimit: config.statorCurrentLimit ?? 80,
        supplyCurrentLimit: config.supplyCurrentLimit ?? 40,
      },
    });
    const encoder = instantiateCatalogDevice({
      canBus: config.canBus,
      canId: config.encoderIds[index] ?? 0,
      componentId: 'ironpulse.cancoder',
      displayName: `${moduleNames[index] ?? 'Module'} Encoder`,
      parentId: mechanism.id,
      selectedParameters: ['magnetOffset'],
      values: { magnetOffset: config.encoderOffsets[index] ?? 0 },
    });
    devices.push(
      stableDevice(drive, stableId(`${mechanism.id}:drive`), 'swerve-drive'),
      stableDevice(steer, stableId(`${mechanism.id}:steer`), 'swerve-steer'),
      stableDevice(encoder, stableId(`${mechanism.id}:encoder`), 'swerve-encoder'),
    );
  }
  const gyro = instantiateCatalogDevice({
    canBus: config.canBus,
    canId: config.gyroId,
    componentId: 'ironpulse.pigeon2',
    displayName: 'Swerve Gyro',
    parentId: rootId,
    selectedParameters: ['mountRoll', 'mountPitch', 'mountYaw'],
    values: {
      mountPitch: config.gyroMount?.[1] ?? 0,
      mountRoll: config.gyroMount?.[0] ?? 0,
      mountYaw: config.gyroMount?.[2] ?? 0,
    },
  });
  devices.push(stableDevice(gyro, stableId(`${rootId}:gyro`), 'swerve-gyro'));
  const preset = presetInstance(
    'frc.swerve',
    displayName,
    {
      canBus: config.canBus,
      driveIds: config.driveIds,
      driveInverted: config.driveInverted ?? false,
      driveKP: config.driveKP ?? 0,
      driveKV: config.driveKV ?? 0,
      driveRatio: config.driveRatio,
      encoderIds: config.encoderIds,
      encoderOffsets: config.encoderOffsets,
      gyroId: config.gyroId,
      gyroMount: config.gyroMount ?? [0, 0, 0],
      maxSpeed: config.maxSpeed,
      pathRotationKP: config.pathRotationKP ?? 5,
      pathTranslationKP: config.pathTranslationKP ?? 5,
      steerIds: config.steerIds,
      steerInverted: config.steerInverted ?? false,
      steerKD: config.steerKD ?? 0,
      steerKP: config.steerKP ?? 0,
      steerRatio: config.steerRatio,
      trackwidth: config.trackwidth,
      statorCurrentLimit: config.statorCurrentLimit ?? 80,
      supplyCurrentLimit: config.supplyCurrentLimit ?? 40,
      wheelRadius: config.wheelRadius,
      wheelbase: config.wheelbase,
    },
    model.project.id,
  );
  return {
    ...model,
    devices: [...model.devices, ...devices],
    presets: [...model.presets, preset],
    subsystems: [...model.subsystems, root, ...mechanisms],
  };
}

export function instantiateLimelightPreset(
  model: FrcProjectModel,
  config: LimelightPresetConfiguration,
): FrcProjectModel {
  if (!/^[A-Za-z0-9_-]+$/u.test(config.table)) throw new Error('Limelight table name is invalid.');
  if (!Number.isInteger(config.pipeline) || config.pipeline < 0 || config.pipeline > 9)
    throw new Error('Limelight pipeline must be between 0 and 9.');
  if (config.transform.length !== 6 || config.transform.some((value) => !Number.isFinite(value)))
    throw new Error('Limelight transform must contain six finite values.');
  if (
    config.streamMode !== undefined &&
    (!Number.isInteger(config.streamMode) || config.streamMode < 0 || config.streamMode > 2)
  )
    throw new Error('Limelight stream mode must be between 0 and 2.');
  ensurePresetMissing(model, 'frc.limelight');
  const displayName = config.name ?? 'Vision';
  const rootId = stableId(`${model.project.id}:preset:limelight`);
  const root: Subsystem = {
    behaviorMode: 'direct',
    displayName,
    id: rootId,
    javaFile: `src/main/java/${model.project.javaPackage.replace(/\./gu, '/')}/subsystems/vision/LimelightSubsystem.java`,
    javaPackage: `${model.project.javaPackage}.subsystems.vision`,
    kind: 'subsystem',
    realImplementation: true,
    simulationImplementation: true,
    symbol: 'LimelightSubsystem',
  };
  const parameters: DeviceParameter[] = [
    deviceParameter(
      'table',
      'NT table',
      'string',
      config.table,
      'NetworkTables name configured in the Limelight web interface.',
    ),
    deviceParameter(
      'pipeline',
      'Pipeline',
      'number',
      config.pipeline,
      'Active Limelight processing pipeline index.',
    ),
    deviceParameter(
      'streamMode',
      'Stream mode',
      'number',
      config.streamMode ?? 0,
      'Camera stream layout mode selected by the Limelight.',
    ),
    deviceParameter(
      'transform',
      'Robot-to-camera transform',
      'number[]',
      config.transform,
      'Camera X/Y/Z position in meters and roll/pitch/yaw in degrees relative to robot origin.',
    ),
  ];
  const camera: Device = {
    catalogId: 'frc.limelight',
    displayName: config.deviceName ?? config.table,
    id: stableId(`${rootId}:camera`),
    kind: 'camera',
    model: 'Limelight',
    parameters,
    parentId: rootId,
    role: 'localization-and-aiming',
    symbol: 'LimelightCamera',
    vendor: 'Limelight Vision',
  };
  const preset = presetInstance(
    'frc.limelight',
    displayName,
    {
      deviceName: config.deviceName ?? config.table,
      pipeline: config.pipeline,
      streamMode: config.streamMode ?? 0,
      table: config.table,
      transform: config.transform,
    },
    model.project.id,
  );
  return {
    ...model,
    devices: [...model.devices, camera],
    presets: [...model.presets, preset],
    subsystems: [...model.subsystems, root],
  };
}

export function instantiateCommonPreset(
  model: FrcProjectModel,
  presetId: CommonPresetId,
  config: CommonPresetConfiguration,
): FrcProjectModel {
  const name = config.name.trim();
  if (name.length === 0) throw new Error('Common preset name is required.');
  const parent =
    config.parentId === undefined
      ? undefined
      : model.subsystems.find((entry) => entry.id === config.parentId);
  if (config.parentId !== undefined && parent === undefined) {
    throw new Error('The selected preset parent no longer exists.');
  }
  const canBus = config.canBus?.trim() || 'rio';
  const canId = config.canId ?? 0;
  const channel = config.channel ?? 0;
  if (presetId !== 'frc.led-indicator' && (!Number.isInteger(canId) || canId < 0 || canId > 62))
    throw new Error('Common preset CAN ID must be between 0 and 62.');
  const followerIds = config.followerIds ?? [];
  if (new Set([canId, ...followerIds]).size !== 1 + followerIds.length) {
    throw new Error('Leader and follower CAN IDs must be unique.');
  }
  if (presetId === 'frc.velocity-flywheel' || presetId === 'frc.position-mechanism') {
    validateNamedSetpoints(presetId, config.setpoints, config.setpointUnit);
  }
  const symbol = javaSymbol(name, 'Mechanism');
  const siblingConflict = model.subsystems.some(
    (entry) => entry.parentId === config.parentId && entry.symbol === symbol,
  );
  if (siblingConflict) {
    throw new Error(`A node named ${symbol} already exists at the selected location.`);
  }
  const rootId = stableId(
    `${model.project.id}:preset:${presetId}:${config.parentId ?? 'project-root'}:${symbol}`,
  );
  const goalDriven = [
    'frc.velocity-flywheel',
    'frc.position-mechanism',
    'frc.beambreak-indexer',
  ].includes(presetId);
  const root: Subsystem = {
    behaviorMode: goalDriven ? 'goal-driven' : 'direct',
    displayName: name,
    id: rootId,
    kind: parent === undefined ? 'subsystem' : 'mechanism',
    ...(parent === undefined ? {} : { parentId: parent.id }),
    realImplementation: true,
    simulationImplementation: true,
    ...(goalDriven
      ? {
          generateGoalCommand: true,
          stateMachine: {
            states: presetStates(rootId, presetId, config.setpoints),
            transitions: [],
          },
        }
      : {}),
    symbol,
  };
  const devices: Device[] = [];
  if (presetId !== 'frc.led-indicator') {
    const motor = instantiateCatalogDevice({
      canBus,
      canId,
      componentId: 'ironpulse.talonfx-primary',
      displayName: `${name} Motor`,
      parentId: rootId,
      selectedParameters:
        presetId === 'frc.position-mechanism'
          ? [
              'forwardSoftLimit',
              'forwardSoftLimitEnabled',
              'kA',
              'kG',
              'kS',
              'kV',
              'reverseSoftLimit',
              'reverseSoftLimitEnabled',
              'zeroingCurrent',
              'zeroingFilterSize',
              'zeroingVoltage',
            ]
          : presetId === 'frc.velocity-flywheel'
            ? ['closedLoopRamp', 'kP', 'kI', 'kD', 'kS', 'kV', 'kA']
            : [],
      values:
        presetId === 'frc.position-mechanism'
          ? {
              forwardSoftLimit: 1,
              forwardSoftLimitEnabled: true,
              kA: 0.1,
              kD: 0.01,
              kG: 0.18,
              kP: 100,
              kS: 0.18,
              kV: 6,
              reverseSoftLimit: 0,
              reverseSoftLimitEnabled: true,
              zeroingCurrent: 30,
              zeroingVoltage: -1,
            }
          : presetId === 'frc.velocity-flywheel'
            ? {
                kA: 0.01,
                kP: 0.25,
                kS: 0.01,
                kV: 0.092,
                neutralMode: 'coast',
              }
            : {},
    });
    devices.push(stableDevice(motor, stableId(`${rootId}:motor`), 'primary'));
    for (const [index, followerId] of followerIds.entries()) {
      if (!Number.isInteger(followerId) || followerId < 0 || followerId > 62)
        throw new Error('Follower CAN IDs must be between 0 and 62.');
      const follower = instantiateCatalogDevice({
        canBus,
        canId: followerId,
        componentId: 'ironpulse.talonfx-follower',
        displayName: `${name} Follower ${String(index + 1)}`,
        parentId: rootId,
        values: { leaderId: stableId(`${rootId}:motor`), opposeLeader: false },
      });
      devices.push(
        stableDevice(follower, stableId(`${rootId}:follower:${String(index)}`), 'follower'),
      );
    }
  }
  if (presetId === 'frc.velocity-flywheel' || presetId === 'frc.position-mechanism') {
    const mechanism = instantiateCatalogDevice({
      componentId:
        presetId === 'frc.velocity-flywheel'
          ? 'ironpulse.velocity-mechanism'
          : 'ironpulse.position-mechanism',
      displayName: `${name} Setpoints`,
      parentId: rootId,
      values: {
        setpoints: config.setpoints ?? ['IDLE=0', 'ACTIVE=1'],
        setpointUnit: config.setpointUnit ?? (presetId === 'frc.velocity-flywheel' ? 'rps' : 'rot'),
      },
    });
    devices.push(stableDevice(mechanism, stableId(`${rootId}:setpoints`), 'setpoints'));
  }
  if (presetId === 'frc.beambreak-indexer') {
    const sensor = instantiateCatalogDevice({
      componentId: 'ironpulse.beam-break',
      displayName: `${name} Beam Break`,
      parentId: rootId,
      selectedParameters: ['portType', 'threshold', 'inverted'],
      values: { channel, inverted: false, portType: 'dio', threshold: 2.5 },
    });
    devices.push(stableDevice(sensor, stableId(`${rootId}:beam-break`), 'piece-detection'));
  }
  if (presetId === 'frc.led-indicator') {
    const indicator = instantiateCatalogDevice({
      componentId: 'ironpulse.indicator',
      displayName: `${name} LED`,
      parentId: rootId,
      values: { channel, length: 60 },
    });
    devices.push(stableDevice(indicator, stableId(`${rootId}:indicator`), 'status'));
  }
  const preset = presetInstance(
    presetId,
    name,
    {
      canBus,
      canId,
      channel,
      followerIds: config.followerIds ?? [],
      parentId: config.parentId ?? '',
      rootSubsystemId: rootId,
      setpoints: config.setpoints ?? [],
      setpointUnit: config.setpointUnit ?? '',
    },
    rootId,
  );
  return {
    ...model,
    devices: [...model.devices, ...devices],
    presets: [...model.presets, preset],
    subsystems: [...model.subsystems, root],
  };
}

function validateNamedSetpoints(
  presetId: 'frc.velocity-flywheel' | 'frc.position-mechanism',
  configured: readonly string[] | undefined,
  configuredUnit: string | undefined,
): void {
  const setpoints = configured ?? ['IDLE=0', 'ACTIVE=1'];
  if (setpoints.length === 0) throw new Error('At least one named setpoint is required.');
  const names: string[] = [];
  for (const entry of setpoints) {
    const match = /^\s*([A-Za-z_$][A-Za-z\d_$]*)\s*=\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*$/u.exec(
      entry,
    );
    if (match?.[1] === undefined || match[2] === undefined || !Number.isFinite(Number(match[2]))) {
      throw new Error(`Invalid named setpoint: ${entry}. Use NAME=value.`);
    }
    names.push(match[1].toUpperCase());
  }
  if (new Set(names).size !== names.length) throw new Error('Named setpoint names must be unique.');
  const unit = configuredUnit ?? (presetId === 'frc.velocity-flywheel' ? 'rps' : 'rot');
  const allowed = presetId === 'frc.velocity-flywheel' ? ['rps', 'rpm'] : ['rot', 'deg', 'rad'];
  if (!allowed.includes(unit)) {
    throw new Error(`${presetId} setpoint unit must be one of: ${allowed.join(', ')}.`);
  }
}

function state(seed: string, displayName: string, initial: boolean) {
  return {
    actions: [],
    displayName,
    id: stableId(seed),
    initial,
    symbol: displayName,
  };
}

function presetStates(
  rootId: string,
  presetId: CommonPresetId,
  configuredSetpoints: readonly string[] | undefined,
) {
  const names =
    presetId === 'frc.velocity-flywheel' || presetId === 'frc.position-mechanism'
      ? (configuredSetpoints ?? ['IDLE=0', 'ACTIVE=1']).flatMap((entry) => {
          const match = /^\s*([A-Za-z_$][A-Za-z\d_$]*)\s*=/u.exec(entry);
          return match?.[1] === undefined ? [] : [match[1]];
        })
      : ['IDLE', 'ACTIVE'];
  const unique = [...new Set(names.length === 0 ? ['IDLE', 'ACTIVE'] : names)];
  return unique.map((name, index) => state(`${rootId}:goal:${name}`, name, index === 0));
}

function validateSwerve(config: SwervePresetConfiguration): void {
  for (const [name, value] of Object.entries({
    driveRatio: config.driveRatio,
    maxSpeed: config.maxSpeed,
    steerRatio: config.steerRatio,
    trackwidth: config.trackwidth,
    wheelRadius: config.wheelRadius,
    wheelbase: config.wheelbase,
  })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be positive.`);
  }
  const ids = [...config.driveIds, ...config.steerIds, ...config.encoderIds, config.gyroId];
  if (ids.some((id) => !Number.isInteger(id) || id < 0 || id > 62))
    throw new Error('Swerve CAN IDs must be between 0 and 62.');
  if (new Set(ids).size !== ids.length) throw new Error('Swerve CAN IDs must be unique.');
  if (config.encoderOffsets.some((offset) => offset < -0.5 || offset > 0.5))
    throw new Error('Swerve encoder offsets must be between -0.5 and 0.5 rotations.');
  for (const [name, value] of Object.entries({
    driveKP: config.driveKP,
    driveKV: config.driveKV,
    statorCurrentLimit: config.statorCurrentLimit,
    steerKD: config.steerKD,
    steerKP: config.steerKP,
    supplyCurrentLimit: config.supplyCurrentLimit,
    pathRotationKP: config.pathRotationKP,
    pathTranslationKP: config.pathTranslationKP,
  })) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0))
      throw new Error(`${name} must be a non-negative finite number.`);
  }
  if (
    config.gyroMount !== undefined &&
    (config.gyroMount.length !== 3 ||
      config.gyroMount.some((angle) => !Number.isFinite(angle) || angle < -180 || angle > 180))
  )
    throw new Error(
      'Swerve gyro mount must contain roll, pitch, and yaw between -180 and 180 degrees.',
    );
}

function ensurePresetMissing(model: FrcProjectModel, presetId: string): void {
  if (model.presets.some((preset) => preset.presetId === presetId))
    throw new Error(`${presetId} is already instantiated.`);
}

function presetInstance(
  presetId: string,
  displayName: string,
  parameters: Readonly<Record<string, ParameterValue>>,
  instanceSeed: string,
): PresetInstance {
  return {
    customizedFiles: [],
    displayName,
    id: stableId(`${instanceSeed}:${presetId}:instance`),
    parameters,
    presetId,
    version: 1,
  };
}

function deviceParameter(
  key: string,
  displayName: string,
  type: DeviceParameter['type'],
  value: ParameterValue,
  description: string,
): DeviceParameter {
  return {
    description,
    displayName,
    id: stableId(`parameter:${key}`),
    key,
    networkTables: { enabled: true, writable: true },
    source: 'preset',
    type,
    value,
  };
}

function stableDevice(device: Device, id: string, role: string): Device {
  return {
    ...device,
    id,
    parameters: device.parameters.map((parameter) => ({
      ...parameter,
      id: stableId(`${id}:parameter:${parameter.key}`),
    })),
    role,
  };
}

function stableId(value: string): string {
  return stablePresetEntityId(value);
}
