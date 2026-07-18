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
  ensurePresetMissing(model, presetId);
  const name = config.name.trim();
  if (name.length === 0) throw new Error('Common preset name is required.');
  const canBus = config.canBus?.trim() || 'rio';
  const canId = config.canId ?? 0;
  const channel = config.channel ?? 0;
  if (presetId !== 'frc.led-indicator' && (!Number.isInteger(canId) || canId < 0 || canId > 62))
    throw new Error('Common preset CAN ID must be between 0 and 62.');
  const rootId = stableId(`${model.project.id}:preset:${presetId}`);
  const symbol = javaSymbol(name, 'Mechanism');
  const goalDriven = [
    'frc.velocity-flywheel',
    'frc.position-mechanism',
    'frc.beambreak-indexer',
  ].includes(presetId);
  const root: Subsystem = {
    behaviorMode: goalDriven ? 'goal-driven' : 'direct',
    displayName: name,
    id: rootId,
    kind: 'subsystem',
    realImplementation: true,
    simulationImplementation: true,
    ...(goalDriven
      ? {
          generateGoalCommand: true,
          stateMachine: {
            states: [
              state(`${rootId}:idle`, 'Idle', true),
              state(`${rootId}:active`, 'Active', false),
            ],
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
              'reverseSoftLimit',
              'reverseSoftLimitEnabled',
              'zeroingCurrent',
              'zeroingVoltage',
            ]
          : presetId === 'frc.velocity-flywheel'
            ? ['kP', 'kV']
            : [],
      values:
        presetId === 'frc.position-mechanism'
          ? {
              forwardSoftLimit: 1,
              forwardSoftLimitEnabled: true,
              reverseSoftLimit: 0,
              reverseSoftLimitEnabled: true,
              zeroingCurrent: 30,
              zeroingVoltage: -1,
            }
          : {},
    });
    devices.push(stableDevice(motor, stableId(`${rootId}:motor`), 'primary'));
    for (const [index, followerId] of (config.followerIds ?? []).entries()) {
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
      setpoints: config.setpoints ?? [],
      setpointUnit: config.setpointUnit ?? '',
    },
    model.project.id,
  );
  return {
    ...model,
    devices: [...model.devices, ...devices],
    presets: [...model.presets, preset],
    subsystems: [...model.subsystems, root],
  };
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
  projectId: string,
): PresetInstance {
  return {
    customizedFiles: [],
    displayName,
    id: stableId(`${projectId}:${presetId}:instance`),
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
