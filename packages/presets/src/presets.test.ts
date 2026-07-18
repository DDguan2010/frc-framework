import { createEmptyProject, validateModel } from '@frc-framework/domain';
import { describe, expect, it } from 'vitest';

import {
  generatePresetFiles,
  instantiateCommonPreset,
  instantiateLimelightPreset,
  instantiateSwervePreset,
  stablePresetEntityId,
  PRESET_API_VERSION,
  PRESET_MANIFESTS,
} from './index.js';

function model() {
  return createEmptyProject({
    id: 'e936f1cc-40ce-476a-b37f-99303195db93',
    javaPackage: 'frc.robot.alpha',
    name: 'Alpha Robot',
    teamNumber: 10541,
    wpilibYear: 2026,
  });
}

const swerveConfiguration = {
  canBus: 'canivore',
  driveIds: [1, 2, 3, 4] as const,
  driveRatio: 6.75,
  encoderIds: [9, 10, 11, 12] as const,
  encoderOffsets: [0.1, -0.2, 0.3, -0.4] as const,
  gyroId: 13,
  maxSpeed: 4.5,
  steerIds: [5, 6, 7, 8] as const,
  steerRatio: 21.428,
  trackwidth: 0.55,
  wheelRadius: 0.0508,
  wheelbase: 0.55,
};

describe('preset manifests and instances', () => {
  it('creates the same stable IDs in browser and Node runtimes without node:crypto', () => {
    expect(stablePresetEntityId('abc')).toBe('ba7816bf-8f01-5fea-8141-40de5dae2223');
    expect(stablePresetEntityId('project:preset:swerve')).toBe(
      '04f31541-f7d0-5282-9d95-0b49a3cbf697',
    );
  });

  it('publishes versioned manifests with declared parameters, outputs, docs, and calibration', () => {
    expect(PRESET_MANIFESTS.map((entry) => entry.id)).toEqual([
      'frc.swerve',
      'frc.limelight',
      'frc.percent-output',
      'frc.velocity-flywheel',
      'frc.position-mechanism',
      'frc.beambreak-indexer',
      'frc.led-indicator',
    ]);
    for (const manifest of PRESET_MANIFESTS) {
      expect(manifest.apiVersion).toBe(PRESET_API_VERSION);
      expect(manifest.parameters.length).toBeGreaterThan(0);
      expect(manifest.outputs.length).toBeGreaterThan(0);
      expect(manifest.documentation).toMatch(/^docs\//u);
      expect(manifest.calibrationSteps.length).toBeGreaterThan(2);
    }
  });

  it('instantiates a deterministic four-module hierarchy and rejects unsafe CAN layouts', () => {
    const first = instantiateSwervePreset(model(), swerveConfiguration);
    const second = instantiateSwervePreset(model(), swerveConfiguration);
    expect(first.subsystems).toEqual(second.subsystems);
    expect(first.devices).toEqual(second.devices);
    expect(first.presets).toEqual(second.presets);
    expect(first.subsystems).toHaveLength(5);
    expect(first.devices.filter((device) => device.kind === 'motor')).toHaveLength(8);
    expect(first.devices.filter((device) => device.kind === 'encoder')).toHaveLength(4);
    expect(first.presets[0]?.presetId).toBe('frc.swerve');
    expect(validateModel(first).filter((problem) => problem.severity === 'error')).toEqual([]);
    expect(() => instantiateSwervePreset(first, swerveConfiguration)).toThrow(
      'already instantiated',
    );
    expect(() =>
      instantiateSwervePreset(model(), {
        ...swerveConfiguration,
        steerIds: [1, 6, 7, 8],
      }),
    ).toThrow('unique');
  });

  it('instantiates Limelight and validates table, pipeline, and transform', () => {
    const configured = instantiateLimelightPreset(model(), {
      pipeline: 2,
      table: 'limelight-front',
      transform: [0.25, 0, 0.4, 0, -15, 0],
    });
    expect(configured.devices[0]?.kind).toBe('camera');
    expect(configured.presets[0]?.parameters.table).toBe('limelight-front');
    expect(validateModel(configured).filter((problem) => problem.severity === 'error')).toEqual([]);
    expect(() =>
      instantiateLimelightPreset(model(), {
        pipeline: 10,
        table: 'limelight',
        transform: [0, 0, 0, 0, 0, 0],
      }),
    ).toThrow('pipeline');
  });

  it('instantiates all common mechanism presets with ordinary hierarchy and hardware', () => {
    let configured = instantiateCommonPreset(model(), 'frc.percent-output', {
      canId: 20,
      name: 'Intake',
    });
    configured = instantiateCommonPreset(configured, 'frc.velocity-flywheel', {
      canId: 21,
      followerIds: [22],
      name: 'Shooter',
      setpointUnit: 'rps',
      setpoints: ['IDLE=0', 'SPEAKER=90'],
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
    expect(configured.presets).toHaveLength(5);
    expect(configured.devices.filter((device) => device.kind === 'motor')).toHaveLength(5);
    expect(configured.devices.some((device) => device.catalogId === 'ironpulse.beam-break')).toBe(
      true,
    );
    expect(configured.devices.some((device) => device.catalogId === 'ironpulse.indicator')).toBe(
      true,
    );
    expect(validateModel(configured).filter((problem) => problem.severity === 'error')).toEqual([]);
    expect(generatePresetFiles(configured).has('docs/VELOCITY_FLYWHEEL.md')).toBe(true);
  });

  it('generates deterministic, ordinary Java and calibration documents', () => {
    const configured = instantiateLimelightPreset(
      instantiateSwervePreset(model(), swerveConfiguration),
      { pipeline: 1, table: 'limelight', transform: [0.2, 0, 0.5, 0, -12, 0] },
    );
    const first = generatePresetFiles(configured);
    const second = generatePresetFiles(configured);
    expect([...first]).toEqual([...second]);
    expect(first.size).toBe(14);
    expect(
      first.get('src/main/java/frc/robot/alpha/subsystems/swerve/SwerveSubsystem.java'),
    ).toContain('SwerveDriveOdometry');
    expect(
      first.get('src/main/java/frc/robot/alpha/subsystems/vision/LimelightSubsystem.java'),
    ).toContain('getEstimatedPoseBlue');
    expect(first.get('docs/SWERVE.md')).toContain('absolute encoder offsets');
    expect(first.get('docs/LIMELIGHT.md')).toContain('capture timestamps');
  });
});
