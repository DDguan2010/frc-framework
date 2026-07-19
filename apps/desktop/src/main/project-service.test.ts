import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { generateStructuredFiles } from '@frc-framework/code-generator';
import { createEmptyProject, createEntityId } from '@frc-framework/domain';
import { instantiateCatalogDevice } from '@frc-framework/frc-catalog';
import { instantiateCommonPreset, instantiateSwervePreset } from '@frc-framework/presets';
import { parseProjectYaml, stringifyProjectYaml } from '@frc-framework/project-io';
import { describe, expect, it } from 'vitest';

import { ProjectService } from './project-service.js';
import { SettingsStore } from './settings-store.js';

describe('ProjectService structured edits', () => {
  const referenceRobot = path.resolve('../2026-offseason-robot-10541');

  it.runIf(existsSync(referenceRobot))(
    'keeps obsolete imported helpers out of the real 10541 logic tree',
    async () => {
      const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-reference-state-'));
      const store = new SettingsStore(path.join(stateRoot, 'state.json'));
      await store.load();
      const service = new ProjectService(store, path.resolve('resources/base-template'));
      try {
        const opened = await service.open(referenceRobot);
        const symbols = opened.model?.subsystems.map((entry) => entry.symbol) ?? [];
        expect(symbols).toContain('ShootingSuperstructure');
        expect(symbols).not.toContain('Configs');
        expect(symbols).not.toContain('ShotCalculator');
        expect(symbols.some((symbol) => symbol.endsWith('Config'))).toBe(false);
      } finally {
        await service.close();
      }
    },
    30_000,
  );

  it('repairs legacy source imports without showing config classes as subsystems', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-legacy-source-'));
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-legacy-source-state-'));
    const base = createEmptyProject({
      javaPackage: 'frc.robot',
      name: 'Legacy Source Robot',
      teamNumber: 10541,
      wpilibYear: 2026,
    });
    const configRootId = '11111111-1111-5111-8111-111111111111';
    const configId = '22222222-2222-5222-8222-222222222222';
    const intakeId = '33333333-3333-5333-8333-333333333333';
    const configPath = 'src/main/java/frc/robot/subsystems/Configs/DriveConfig.java';
    const intakePath = 'src/main/java/frc/robot/subsystems/Intake/IntakeSubsystem.java';
    const legacy = {
      ...base,
      subsystems: [
        {
          behaviorMode: 'custom' as const,
          displayName: 'Configs',
          id: configRootId,
          javaPackage: 'frc.robot.subsystems.Configs',
          kind: 'subsystem' as const,
          symbol: 'Configs',
        },
        {
          displayName: 'DriveConfig',
          id: configId,
          javaFile: configPath,
          javaPackage: 'frc.robot.subsystems.Configs',
          kind: 'mechanism' as const,
          parentId: configRootId,
          symbol: 'DriveConfig',
        },
        {
          behaviorMode: 'custom' as const,
          displayName: 'IntakeSubsystem',
          id: intakeId,
          javaFile: intakePath,
          javaPackage: 'frc.robot.subsystems.Intake',
          kind: 'subsystem' as const,
          symbol: 'IntakeSubsystem',
        },
      ],
      unmanagedFiles: [],
    };
    await writeFile(path.join(root, 'project.yaml'), stringifyProjectYaml(legacy), 'utf8');
    await mkdir(path.dirname(path.join(root, configPath)), { recursive: true });
    await mkdir(path.dirname(path.join(root, intakePath)), { recursive: true });
    const configSource = `package frc.robot.subsystems.Configs;
public final class DriveConfig { public static final int MOTOR_ID = 20; }
`;
    await writeFile(path.join(root, configPath), configSource, 'utf8');
    await writeFile(
      path.join(root, intakePath),
      `package frc.robot.subsystems.Intake;
import edu.wpi.first.wpilibj2.command.SubsystemBase;
public final class IntakeSubsystem extends SubsystemBase {}
`,
      'utf8',
    );

    const store = new SettingsStore(path.join(stateRoot, 'state.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      const opened = await service.open(root);
      expect(opened.model?.subsystems.map((entry) => entry.symbol)).toContain('IntakeSubsystem');
      expect(opened.model?.subsystems.some((entry) => entry.symbol.endsWith('Config'))).toBe(false);
      expect(opened.model?.subsystems.some((entry) => entry.symbol === 'Configs')).toBe(false);

      const preview = await service.previewCommand({
        changes: { teamNumber: 6941 },
        target: { scope: 'project' },
        type: 'update',
      });
      expect(preview.problems).toEqual([]);
      await service.applyPreview(preview.id);
      expect(await readFile(path.join(root, configPath), 'utf8')).toBe(configSource);
      const repaired = parseProjectYaml(await readFile(path.join(root, 'project.yaml'), 'utf8'));
      expect(repaired.problems).toEqual([]);
      expect(repaired.model?.subsystems.map((entry) => entry.symbol)).toEqual(['IntakeSubsystem']);
      expect(repaired.model?.unmanagedFiles).toEqual(
        expect.arrayContaining([configPath, intakePath]),
      );

      const reopened = await service.refresh();
      expect(reopened.model?.subsystems.map((entry) => entry.symbol)).toContain('IntakeSubsystem');
      expect(reopened.model?.subsystems.some((entry) => entry.symbol.endsWith('Config'))).toBe(
        false,
      );
    } finally {
      await service.close();
    }
  });

  it('moves automatic Java trees with their config and team-owned source intact', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-service-relocate-'));
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-relocate-state-'));
    const intakeId = createEntityId();
    const shooterId = createEntityId();
    const pivotId = createEntityId();
    const base = createEmptyProject({
      javaPackage: 'frc.robot',
      name: 'Relocate Robot',
      teamNumber: 10541,
      wpilibYear: 2026,
    });
    const pivotMotor = instantiateCatalogDevice({
      canId: 20,
      componentId: 'ironpulse.talonfx-primary',
      displayName: 'Pivot Motor',
      parentId: pivotId,
    });
    const model = {
      ...base,
      devices: [pivotMotor],
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
    await writeStructuredFixture(root, model);
    const oldRuntime = 'src/main/java/frc/robot/subsystems/intake/pivot/Pivot.java';
    const oldConfig = 'src/main/java/frc/robot/subsystems/intake/pivot/PivotConfig.java';
    const newRuntime = 'src/main/java/frc/robot/subsystems/shooter/pivot/Pivot.java';
    const newConfig = 'src/main/java/frc/robot/subsystems/shooter/pivot/PivotConfig.java';
    const oldSource = await readFile(path.join(root, oldRuntime), 'utf8');
    await writeFile(
      path.join(root, oldRuntime),
      oldSource
        .replace(
          'package frc.robot.subsystems.intake.pivot;',
          'package frc.robot.subsystems.intake.pivot;\n\nimport java.util.Optional;',
        )
        .replace(
          /\n\}\s*$/u,
          '\n    public Optional<String> teamOwnedStatus() { return Optional.empty(); }\n}\n',
        ),
      'utf8',
    );

    const store = new SettingsStore(path.join(stateRoot, 'state.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      await service.open(root);
      const preview = await service.previewCommand({
        changes: { parentId: shooterId },
        target: { collection: 'subsystems', id: pivotId, scope: 'entity' },
        type: 'update',
      });
      expect(preview.problems).toEqual([]);
      expect(preview.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'deleted', path: oldRuntime }),
          expect.objectContaining({ kind: 'deleted', path: oldConfig }),
          expect.objectContaining({ kind: 'added', path: newRuntime }),
          expect.objectContaining({ kind: 'added', path: newConfig }),
        ]),
      );
      const applied = await service.applyPreview(preview.id);
      const moved = applied.model?.subsystems.find((entry) => entry.id === pivotId);
      expect(moved?.parentId).toBe(shooterId);
      expect(moved).not.toHaveProperty('javaFile');
      expect(moved).not.toHaveProperty('javaPackage');
      const relocatedSource = await readFile(path.join(root, newRuntime), 'utf8');
      expect(relocatedSource).toContain('package frc.robot.subsystems.shooter.pivot;');
      expect(relocatedSource).toContain('import java.util.Optional;');
      expect(relocatedSource).toContain('teamOwnedStatus()');
      expect(await readFile(path.join(root, newConfig), 'utf8')).toContain('class PivotConfig');
      await expect(readFile(path.join(root, oldRuntime), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(readFile(path.join(root, oldConfig), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(
        service.previewCommand({
          collection: 'subsystems',
          id: pivotId,
          symbol: 'ShooterPivot',
          type: 'rename',
        }),
      ).rejects.toThrow('team-owned code');
    } finally {
      await service.close();
    }
  });

  it('keeps structured edits working when unchanged full-file preset Java already exists', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-service-preset-'));
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-preset-state-'));
    const base = createEmptyProject({
      javaPackage: 'frc.robot',
      name: 'Preset Robot',
      teamNumber: 10541,
      wpilibYear: 2026,
    });
    const swerve = instantiateSwervePreset(base, {
      canBus: 'rio',
      driveIds: [1, 2, 3, 4],
      driveRatio: 6.75,
      encoderIds: [9, 10, 11, 12],
      encoderOffsets: [0, 0, 0, 0],
      gyroId: 13,
      maxSpeed: 4.5,
      steerIds: [5, 6, 7, 8],
      steerRatio: 12.8,
      trackwidth: 0.55,
      wheelRadius: 0.05,
      wheelbase: 0.55,
    });
    await writeStructuredFixture(root, swerve);
    const legacySwervePath = path.join(
      root,
      'src/main/java/frc/robot/subsystems/swerve/SwerveSubsystem.java',
    );
    const legacySwerve = await readFile(legacySwervePath, 'utf8');
    await writeFile(
      legacySwervePath,
      legacySwerve.replace(
        '\n    private void configurePathPlanner()',
        '\n\n    private void configurePathPlanner()',
      ),
      'utf8',
    );
    const staleFullFilePath = path.join(
      root,
      'src/main/java/frc/robot/subsystems/swerve/SwerveConfig.java',
    );
    await writeFile(
      staleFullFilePath,
      `${await readFile(staleFullFilePath, 'utf8')}\n// Output retained from an older generator version.\n`,
      'utf8',
    );
    const store = new SettingsStore(path.join(stateRoot, 'state.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      await service.open(root);
      const swerveRoot = swerve.subsystems.find(
        (subsystem) => subsystem.kind === 'subsystem' && subsystem.parentId === undefined,
      );
      if (swerveRoot === undefined) throw new Error('Expected the Swerve root subsystem.');
      const mechanismId = createEntityId();
      const mechanism = await service.previewCommand({
        collection: 'subsystems',
        entity: {
          displayName: 'Odometry Helper',
          id: mechanismId,
          kind: 'mechanism',
          parentId: swerveRoot.id,
          symbol: 'OdometryHelper',
        },
        type: 'add',
      });
      expect(mechanism.problems).toEqual([]);
      await service.applyPreview(mechanism.id);
      const helperId = createEntityId();
      const helper = await service.previewCommand({
        collection: 'subsystems',
        entity: {
          displayName: 'Zero Helper',
          id: helperId,
          kind: 'mechanism',
          parentId: mechanismId,
          symbol: 'ZeroHelper',
        },
        type: 'add',
      });
      expect(helper.problems).toEqual([]);
      await service.applyPreview(helper.id);
      const withGoals = await service.previewCommand({
        changes: {
          behaviorMode: 'goal-driven',
          stateMachine: {
            states: ['Idle', 'Zeroing', 'Ready'].map((symbol, index) => ({
              actions: [],
              displayName: symbol,
              id: createEntityId(),
              initial: index === 0,
              symbol,
            })),
            transitions: [],
          },
        },
        target: { collection: 'subsystems', id: mechanismId, scope: 'entity' },
        type: 'update',
      });
      expect(withGoals.problems).toEqual([]);
      await service.applyPreview(withGoals.id);
      const mechanismPath =
        'src/main/java/frc/robot/subsystems/swerve/odometryHelper/OdometryHelper.java';
      const helperPath =
        'src/main/java/frc/robot/subsystems/swerve/odometryHelper/zeroHelper/ZeroHelper.java';
      expect(await readFile(path.join(root, mechanismPath), 'utf8')).toContain('READY');
      expect(await readFile(path.join(root, helperPath), 'utf8')).toContain(
        'public final class ZeroHelper',
      );
      const mechanismRemoval = await service.previewCommand({
        collection: 'subsystems',
        id: mechanismId,
        type: 'remove',
      });
      expect(mechanismRemoval.problems).toEqual([]);
      expect(mechanismRemoval.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'deleted', path: mechanismPath }),
          expect.objectContaining({ kind: 'deleted', path: helperPath }),
        ]),
      );
      const afterMechanismRemoval = await service.applyPreview(mechanismRemoval.id);
      await expect(readFile(path.join(root, mechanismPath), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(readFile(path.join(root, helperPath), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
      const swerveCommandIds =
        afterMechanismRemoval.model?.commands.map((command) => command.id) ?? [];
      expect(new Set(swerveCommandIds).size).toBe(swerveCommandIds.length);

      const position = instantiateCommonPreset(swerve, 'frc.position-mechanism', {
        canBus: 'rio',
        canId: 20,
        name: 'Arm',
        setpoints: ['HOME=0', 'ACTIVE=1'],
        setpointUnit: 'rot',
      });
      const preview = await service.previewCommand({
        changes: {
          devices: position.devices,
          presets: position.presets,
          subsystems: position.subsystems,
        },
        target: { scope: 'model' },
        type: 'update',
      });
      expect(preview.problems).toEqual([]);
      expect(preview.changes.some((change) => change.path.endsWith('/Arm.java'))).toBe(true);
      const added = await service.applyPreview(preview.id);
      const arm = added.model?.subsystems.find((subsystem) => subsystem.displayName === 'Arm');
      if (arm === undefined) throw new Error('Expected the position preset subsystem.');

      const removal = await service.previewCommand({
        collection: 'subsystems',
        id: arm.id,
        type: 'remove',
      });
      expect(removal.problems).toEqual([]);
      const removed = await service.applyPreview(removal.id);
      expect(removed.model?.subsystems.some((subsystem) => subsystem.id === arm.id)).toBe(false);
      const commandIds = removed.model?.commands.map((command) => command.id) ?? [];
      expect(new Set(commandIds).size).toBe(commandIds.length);
    } finally {
      await service.close();
    }
  });

  it('deletes a nested node created by the legacy combined-file layout', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-service-legacy-nested-'));
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-legacy-nested-state-'));
    const intakeId = createEntityId();
    const pivotId = createEntityId();
    const base = createEmptyProject({
      javaPackage: 'frc.robot',
      name: 'Legacy Nested Robot',
      teamNumber: 10541,
      wpilibYear: 2026,
    });
    const model = {
      ...base,
      subsystems: [
        {
          behaviorMode: 'goal-driven' as const,
          displayName: 'Intake',
          id: intakeId,
          kind: 'subsystem' as const,
          symbol: 'Intake',
        },
        {
          behaviorMode: 'goal-driven' as const,
          displayName: 'Intake Pivot',
          id: pivotId,
          kind: 'mechanism' as const,
          parentId: intakeId,
          symbol: 'IntakePivot',
        },
      ],
    };
    await writeFile(path.join(root, 'project.yaml'), stringifyProjectYaml(model), 'utf8');
    const intakePath = path.join(root, 'src/main/java/frc/robot/subsystems/intake/Intake.java');
    await mkdir(path.dirname(intakePath), { recursive: true });
    await writeFile(
      intakePath,
      `package frc.robot.subsystems.intake;

public final class Intake {
    // <frc-framework:managed>
    // IntakePivot was embedded here by the legacy generator.
    // </frc-framework:managed>

    public int teamOwnedDiagnostic() { return 10541; }
}
`,
      'utf8',
    );

    const store = new SettingsStore(path.join(stateRoot, 'state.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      await service.open(root);
      const preview = await service.previewCommand({
        collection: 'subsystems',
        id: pivotId,
        type: 'remove',
      });
      expect(preview.problems).toEqual([]);
      expect(preview.changes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'modified',
            path: 'src/main/java/frc/robot/subsystems/intake/Intake.java',
          }),
        ]),
      );
      const applied = await service.applyPreview(preview.id);
      expect(applied.model?.subsystems.some((entry) => entry.id === pivotId)).toBe(false);
      expect(await readFile(intakePath, 'utf8')).toContain('teamOwnedDiagnostic');
      expect(await readFile(intakePath, 'utf8')).not.toContain('embedded here');
    } finally {
      await service.close();
    }
  });

  it('deletes a model-only child from an older full-file preset without regenerating team Java', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-service-old-preset-'));
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-old-preset-state-'));
    const base = createEmptyProject({
      javaPackage: 'frc.robot',
      name: 'Old Preset Robot',
      teamNumber: 10541,
      wpilibYear: 2026,
    });
    const swerve = instantiateSwervePreset(base, {
      canBus: 'rio',
      driveIds: [1, 2, 3, 4],
      driveRatio: 6.75,
      encoderIds: [9, 10, 11, 12],
      encoderOffsets: [0, 0, 0, 0],
      gyroId: 13,
      maxSpeed: 4.5,
      steerIds: [5, 6, 7, 8],
      steerRatio: 12.8,
      trackwidth: 0.55,
      wheelRadius: 0.05,
      wheelbase: 0.55,
    });
    const swerveRoot = swerve.subsystems.find((subsystem) => subsystem.parentId === undefined);
    if (swerveRoot === undefined) throw new Error('Expected the Swerve root subsystem.');
    const accidentalId = createEntityId();
    const model = {
      ...swerve,
      subsystems: [
        ...swerve.subsystems,
        {
          behaviorMode: 'direct' as const,
          displayName: 'intake',
          id: accidentalId,
          kind: 'mechanism' as const,
          parentId: swerveRoot.id,
          symbol: 'intake',
        },
      ],
    };
    await writeStructuredFixture(root, model);
    const javaPath = 'src/main/java/frc/robot/subsystems/swerve/SwerveSubsystem.java';
    const legacyJava = generateStructuredFiles({
      ...swerve,
      subsystems: [swerveRoot],
    }).get(javaPath);
    if (typeof legacyJava !== 'string') throw new Error('Expected generated legacy Java.');
    await writeFile(path.join(root, javaPath), legacyJava, 'utf8');

    const store = new SettingsStore(path.join(stateRoot, 'state.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      await service.open(root);
      const preview = await service.previewCommand({
        collection: 'subsystems',
        id: accidentalId,
        type: 'remove',
      });
      expect(preview.problems).toEqual([]);
      expect(preview.changes.find((change) => change.path === javaPath)?.kind).not.toBe('modified');
      const applied = await service.applyPreview(preview.id);
      expect(applied.model?.subsystems.some((subsystem) => subsystem.id === accidentalId)).toBe(
        false,
      );
      expect(await readFile(path.join(root, javaPath), 'utf8')).toBe(legacyJava);
    } finally {
      await service.close();
    }
  });

  it('previews deletion of Java that belongs to a removed subsystem root', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-service-delete-'));
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-delete-state-'));
    const subsystemId = createEntityId();
    const base = createEmptyProject({
      javaPackage: 'frc.robot',
      name: 'Delete Robot',
      teamNumber: 10541,
      wpilibYear: 2026,
    });
    const model = {
      ...base,
      subsystems: [
        { displayName: 'Arm', id: subsystemId, kind: 'subsystem' as const, symbol: 'Arm' },
      ],
    };
    await writeStructuredFixture(root, model);
    const javaPath = 'src/main/java/frc/robot/subsystems/arm/Arm.java';
    const store = new SettingsStore(path.join(stateRoot, 'state.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      await service.open(root);
      const preview = await service.previewCommand({
        collection: 'subsystems',
        id: subsystemId,
        type: 'remove',
      });
      expect(preview.changes).toContainEqual(
        expect.objectContaining({ kind: 'deleted', path: javaPath }),
      );
      await service.applyPreview(preview.id);
      await expect(readFile(path.join(root, javaPath), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await service.close();
    }
  });

  it('previews legacy schema migration and creates a backup only after confirmation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-service-migration-'));
    const model = createEmptyProject({
      javaPackage: 'frc.robot',
      name: 'Legacy Robot',
      teamNumber: 10541,
      wpilibYear: 2026,
    });
    const legacy = stringifyProjectYaml(model).replace('schemaVersion: 1', 'schemaVersion: 0');
    await writeFile(path.join(root, 'project.yaml'), legacy, 'utf8');
    const store = new SettingsStore(path.join(root, '.state.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      const preview = await service.open(root);
      expect(preview.migration).toMatchObject({ fromVersion: 0, supported: true, toVersion: 1 });
      expect((await readdir(root)).some((entry) => entry.includes('.backup-'))).toBe(false);
      const migrated = await service.migrate();
      expect(migrated.model?.schemaVersion).toBe(1);
      expect((await readdir(root)).some((entry) => entry.includes('.backup-'))).toBe(true);
    } finally {
      await service.close();
    }
  });

  it('previews and transactionally applies YAML, Java, and docs while preserving custom Java', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-service-'));
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-state-'));
    const model = createEmptyProject({
      javaPackage: 'frc.robot',
      name: 'Service Robot',
      teamNumber: 10541,
      wpilibYear: 2026,
    });
    await writeFile(path.join(root, 'project.yaml'), stringifyProjectYaml(model), 'utf8');
    const store = new SettingsStore(path.join(stateRoot, 'state.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      const opened = await service.open(root);
      expect(opened.model?.project.displayName).toBe('Service Robot');
      const shooterId = createEntityId();
      const preview = await service.previewCommand({
        collection: 'subsystems',
        entity: {
          behaviorMode: 'goal-driven',
          displayName: 'Shooter',
          id: shooterId,
          kind: 'subsystem',
          realImplementation: true,
          simulationImplementation: true,
          symbol: 'Shooter',
        },
        type: 'add',
      });
      expect(preview.changes.map((change) => change.path)).toEqual(
        expect.arrayContaining([
          'project.yaml',
          'src/main/java/frc/robot/subsystems/shooter/Shooter.java',
          'docs/SUBSYSTEMS.md',
        ]),
      );
      const applied = await service.applyPreview(preview.id);
      expect(applied.model?.subsystems).toHaveLength(1);
      const shooterPath = path.join(
        root,
        'src/main/java/frc/robot/subsystems/shooter/Shooter.java',
      );
      const customMethod = '\n// Team-owned code\nfinal class ShooterDiagnostics {}\n';
      await writeFile(shooterPath, `${await readFile(shooterPath, 'utf8')}${customMethod}`, 'utf8');

      const mechanismPreview = await service.previewCommand({
        collection: 'subsystems',
        entity: {
          displayName: 'Upper',
          id: createEntityId(),
          kind: 'mechanism',
          parentId: shooterId,
          symbol: 'Upper',
        },
        type: 'add',
      });
      await service.applyPreview(mechanismPreview.id);
      expect(await readFile(shooterPath, 'utf8')).toContain('ShooterDiagnostics');
      const importPreview = await service.addImport({
        file: path.relative(root, shooterPath),
        importName: 'java.util.Optional',
        isStatic: false,
      });
      expect(importPreview.changes[0]?.lines.some((line) => line.text.includes('Optional'))).toBe(
        true,
      );
      await service.applyPreview(importPreview.id);
      expect(await readFile(shooterPath, 'utf8')).toContain('import java.util.Optional;');
      expect(await service.readDocSupplement('docs/SUBSYSTEMS.md')).toContain(
        'Add subsystem behavior',
      );
      const docPreview = await service.previewDocSupplement({
        markdown: 'Team note: inspect flywheel guards before enable.',
        path: 'docs/SUBSYSTEMS.md',
      });
      expect(docPreview.changes.some((change) => change.path === 'docs/SUBSYSTEMS.md')).toBe(true);
      await service.applyPreview(docPreview.id);
      expect(await readFile(path.join(root, 'docs/SUBSYSTEMS.md'), 'utf8')).toContain(
        'inspect flywheel guards',
      );
      await expect(service.readDocSupplement('../README.md')).rejects.toThrow('limited');
    } finally {
      await service.close();
    }
  });

  it('returns blocking model problems and refuses their application', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-service-invalid-'));
    const model = createEmptyProject({
      javaPackage: 'frc.robot',
      name: 'Invalid Test',
      teamNumber: 10541,
      wpilibYear: 2026,
    });
    await writeFile(path.join(root, 'project.yaml'), stringifyProjectYaml(model), 'utf8');
    const store = new SettingsStore(path.join(root, '.settings.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      await service.open(root);
      const preview = await service.previewCommand({
        collection: 'subsystems',
        entity: {
          displayName: 'Invalid',
          id: 'not-a-uuid',
          kind: 'subsystem',
          symbol: 'Invalid',
        },
        type: 'add',
      });
      expect(preview.problems.some((message) => message.includes('UUID'))).toBe(true);
      await expect(service.applyPreview(preview.id)).rejects.toThrow('blocking');
      await service.discardPreview(preview.id);
    } finally {
      await service.close();
    }
  });

  it('overlays source-only commands and autos on refresh without rewriting project.yaml', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-source-sync-'));
    const model = createEmptyProject({
      javaPackage: 'frc.robot',
      name: 'Source Sync',
      teamNumber: 10541,
      wpilibYear: 2026,
    });
    const yaml = stringifyProjectYaml(model);
    await writeFile(path.join(root, 'project.yaml'), yaml, 'utf8');
    const commandsDirectory = path.join(root, 'src/main/java/frc/robot/commands');
    const autosDirectory = path.join(root, 'src/main/java/frc/robot/auto');
    await mkdir(commandsDirectory, { recursive: true });
    await mkdir(autosDirectory, { recursive: true });
    const commandPath = path.join(commandsDirectory, 'TeamCommands.java');
    await writeFile(
      commandPath,
      `package frc.robot.commands;
       import edu.wpi.first.wpilibj2.command.Command;
       public final class TeamCommands { public static Command shoot() { return null; } }
      `,
      'utf8',
    );
    await writeFile(
      path.join(autosDirectory, 'CompetitionAutos.java'),
      `package frc.robot.auto;
       import edu.wpi.first.wpilibj2.command.Command;
       public final class CompetitionAutos {
         public static Command centerFourPiece() { return null; }
       }
      `,
      'utf8',
    );
    const store = new SettingsStore(path.join(root, '.settings.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      const opened = await service.open(root);
      expect(opened.model?.commands.map((command) => command.symbol)).toEqual(
        expect.arrayContaining(['shoot', 'centerFourPiece']),
      );
      expect(opened.model?.autos.map((auto) => auto.symbol)).toContain('centerFourPiece');
      expect(await readFile(path.join(root, 'project.yaml'), 'utf8')).toBe(yaml);

      await writeFile(
        commandPath,
        'package frc.robot.commands; public final class TeamCommands {}\n',
        'utf8',
      );
      const refreshed = await service.refresh();
      expect(refreshed.model?.commands.some((command) => command.symbol === 'shoot')).toBe(false);
      expect(await readFile(path.join(root, 'project.yaml'), 'utf8')).toBe(yaml);
    } finally {
      await service.close();
    }
  });

  it('deduplicates Java overlay commands by stable entity ID after a display-name edit', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-source-id-overlay-'));
    const model = createEmptyProject({
      javaPackage: 'frc.robot',
      name: 'Source ID Overlay',
      teamNumber: 10541,
      wpilibYear: 2026,
    });
    await writeFile(path.join(root, 'project.yaml'), stringifyProjectYaml(model), 'utf8');
    const commandsDirectory = path.join(root, 'src/main/java/frc/robot/commands');
    await mkdir(commandsDirectory, { recursive: true });
    await writeFile(
      path.join(commandsDirectory, 'TeamCommands.java'),
      `package frc.robot.commands;
       import edu.wpi.first.wpilibj2.command.Command;
       public final class TeamCommands { public static Command shoot() { return null; } }
      `,
      'utf8',
    );
    const store = new SettingsStore(path.join(root, '.settings.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      const opened = await service.open(root);
      const inferredShoot = opened.model?.commands.find((command) => command.symbol === 'shoot');
      if (inferredShoot === undefined) throw new Error('Expected inferred shoot command.');
      const structured = {
        ...model,
        commands: [{ ...inferredShoot, displayName: 'Team renamed shoot command' }],
      };
      await writeFile(path.join(root, 'project.yaml'), stringifyProjectYaml(structured), 'utf8');
      const reopened = await service.open(root);
      expect(
        reopened.model?.commands.filter((command) => command.id === inferredShoot.id),
      ).toHaveLength(1);
      expect(
        reopened.model?.commands.find((command) => command.id === inferredShoot.id)?.displayName,
      ).toBe('Team renamed shoot command');
    } finally {
      await service.close();
    }
  });

  it('validates missing PathPlanner files and named commands before writing', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-service-auto-'));
    const model = createEmptyProject({
      javaPackage: 'frc.robot',
      name: 'Auto Test',
      teamNumber: 10541,
      wpilibYear: 2026,
    });
    await writeFile(path.join(root, 'project.yaml'), stringifyProjectYaml(model), 'utf8');
    const store = new SettingsStore(path.join(root, '.settings.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    const commandId = createEntityId();
    const autoId = createEntityId();
    const command = (named: boolean) => ({
      collection: 'commands' as const,
      entity: {
        displayName: 'Score',
        id: commandId,
        kind: 'instant' as const,
        ...(named ? { pathplannerName: 'Score' } : {}),
        requirementIds: [],
        symbol: 'score',
      },
      type: 'add' as const,
    });
    const auto = {
      collection: 'autos' as const,
      entity: {
        commandId,
        displayName: 'Center',
        id: autoId,
        pathFiles: ['pathplanner/autos/Center.auto'],
        symbol: 'center',
      },
      type: 'add' as const,
    };
    try {
      await service.open(root);
      const missing = await service.previewCommand({
        commands: [command(false), auto],
        label: 'Add auto',
        type: 'batch',
      });
      expect(missing.problems.join('\n')).toContain('missing src/main/deploy');
      await service.discardPreview(missing.id);

      const autoDirectory = path.join(root, 'src/main/deploy/pathplanner/autos');
      await mkdir(autoDirectory, { recursive: true });
      await writeFile(
        path.join(autoDirectory, 'Center.auto'),
        JSON.stringify({ command: { data: { name: 'Score' }, type: 'named' } }),
        'utf8',
      );
      const unnamed = await service.previewCommand({
        commands: [command(false), auto],
        label: 'Add auto',
        type: 'batch',
      });
      expect(unnamed.problems.join('\n')).toContain('named command "Score" is not configured');
      await service.discardPreview(unnamed.id);

      const valid = await service.previewCommand({
        commands: [command(true), auto],
        label: 'Add valid auto',
        type: 'batch',
      });
      expect(valid.problems).toEqual([]);
    } finally {
      await service.close();
    }
  });

  it('confirms source fallback by creating YAML and docs without rewriting custom Java', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-source-import-'));
    const sourceDirectory = path.join(root, 'src/main/java/frc/robot/subsystems/Arm');
    await mkdir(sourceDirectory, { recursive: true });
    const sourcePath = path.join(sourceDirectory, 'Arm.java');
    const customJava =
      'package frc.robot.subsystems.Arm; public final class Arm { public int teamCode() { return 42; } }\n';
    await writeFile(sourcePath, customJava, 'utf8');
    await writeFile(
      path.join(root, 'build.gradle'),
      'plugins { id "edu.wpi.first.GradleRIO" version "2026.2.1" }\n',
      'utf8',
    );
    const store = new SettingsStore(path.join(root, '.settings.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      const opened = await service.open(root);
      expect(opened.mode).toBe('source');
      expect(opened.needsImportConfirmation).toBe(true);
      expect(opened.model?.unmanagedFiles).toContain(
        'src/main/java/frc/robot/subsystems/Arm/Arm.java',
      );
      const preview = await service.confirmSourceImport();
      expect(preview.changes.some((change) => change.path === 'project.yaml')).toBe(true);
      expect(preview.changes.some((change) => change.path.endsWith('.java'))).toBe(false);
      await service.applyPreview(preview.id);
      expect(await readFile(sourcePath, 'utf8')).toBe(customJava);
      expect(await readFile(path.join(root, 'project.yaml'), 'utf8')).toContain('schemaVersion: 1');
    } finally {
      await service.close();
    }
  });

  it('refreshes imported subsystem, goal, device, controller, command, and binding overlays', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-live-import-'));
    const subsystemDirectory = path.join(root, 'src/main/java/frc/robot/subsystems/Arm');
    const robotDirectory = path.join(root, 'src/main/java/frc/robot');
    await mkdir(subsystemDirectory, { recursive: true });
    const armPath = path.join(subsystemDirectory, 'ArmSubsystem.java');
    const containerPath = path.join(robotDirectory, 'RobotContainer.java');
    await writeFile(
      armPath,
      `package frc.robot.subsystems.Arm;
       import edu.wpi.first.wpilibj2.command.Command;
       import edu.wpi.first.wpilibj2.command.SubsystemBase;
       import lib.ironpulse.io.MotorIOTalonFX;
       public final class ArmSubsystem extends SubsystemBase {
         enum Goal { STOW, SCORE }
         private final MotorIOTalonFX pivotMotor = null;
         public Command move() { return null; }
       }`,
      'utf8',
    );
    await writeFile(
      containerPath,
      `package frc.robot;
       import edu.wpi.first.wpilibj2.command.button.CommandXboxController;
       public final class RobotContainer {
         private final CommandXboxController driver = new CommandXboxController(0);
         public RobotContainer() { driver.a().onTrue(move()); }
       }`,
      'utf8',
    );
    await writeFile(
      path.join(root, 'build.gradle'),
      'plugins { id "edu.wpi.first.GradleRIO" version "2026.2.1" }\n',
      'utf8',
    );
    const store = new SettingsStore(path.join(root, '.settings.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      await service.open(root);
      const preview = await service.confirmSourceImport();
      await service.applyPreview(preview.id);

      await writeFile(
        armPath,
        `package frc.robot.subsystems.Arm;
         import edu.wpi.first.wpilibj2.command.Command;
         import edu.wpi.first.wpilibj2.command.SubsystemBase;
         import lib.ironpulse.io.MotorIOTalonFX;
         public final class ArmSubsystem extends SubsystemBase {
           enum Goal { STOW, CLIMB }
           private final MotorIOTalonFX shoulderMotor = null;
           public Command hold() { return null; }
         }`,
        'utf8',
      );
      await writeFile(
        containerPath,
        `package frc.robot;
         import edu.wpi.first.wpilibj2.command.button.CommandXboxController;
         public final class RobotContainer {
           private final CommandXboxController driver = new CommandXboxController(3);
           public RobotContainer() { driver.b().whileTrue(hold()); }
         }`,
        'utf8',
      );
      const refreshed = await service.refresh();
      const arm = refreshed.model?.subsystems.find(
        (subsystem) => subsystem.symbol === 'ArmSubsystem',
      );
      expect(arm?.stateMachine?.states.map((state) => state.symbol)).toEqual(['STOW', 'CLIMB']);
      expect(refreshed.model?.devices.map((device) => device.symbol)).toContain('ShoulderMotor');
      expect(refreshed.model?.devices.map((device) => device.symbol)).not.toContain('PivotMotor');
      expect(refreshed.model?.commands.some((command) => command.symbol === 'hold')).toBe(true);
      expect(refreshed.model?.commands.some((command) => command.symbol === 'move')).toBe(false);
      expect(refreshed.model?.controllers[0]?.port).toBe(3);
      expect(refreshed.model?.bindings).toEqual([
        expect.objectContaining({ behavior: 'whileTrue', input: 'driver.b()' }),
      ]);
    } finally {
      await service.close();
    }
  });

  it('presents a broad, typed source inventory while excluding generated directories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-source-files-'));
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-source-state-'));
    const model = createEmptyProject({
      javaPackage: 'frc.robot',
      name: 'File Inventory Robot',
      teamNumber: 10541,
      wpilibYear: 2026,
    });
    await writeFile(path.join(root, 'project.yaml'), stringifyProjectYaml(model), 'utf8');
    const fixtureFiles = new Map<string, string | Uint8Array>([
      ['src/main/java/frc/robot/Robot.java', 'package frc.robot; public class Robot {}'],
      ['src/main/cpp/Robot.cpp', 'int main() { return 0; }'],
      ['src/main/deploy/pathplanner/paths/Center.path', '{}'],
      ['src/main/deploy/elastic-layout.json', '{}'],
      ['ascope_assets/robot.glb', new Uint8Array([0x67, 0x6c, 0x54, 0x46])],
      ['vendordeps/Phoenix6.json', '{}'],
      ['docs/OPERATIONS.md', '# Operations'],
      ['build/generated/Bogus.java', 'public class Bogus {}'],
      ['logs/replay.wpilog', new Uint8Array([1, 2, 3])],
    ]);
    for (const [relativePath, content] of fixtureFiles) {
      const filePath = path.join(root, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, content);
    }

    const store = new SettingsStore(path.join(stateRoot, 'state.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      const opened = await service.open(root);
      const byPath = new Map(opened.sourceFiles.map((file) => [file.path, file]));
      expect(byPath.get('src/main/java/frc/robot/Robot.java')).toMatchObject({
        binary: false,
        format: 'Java',
        kind: 'java',
      });
      expect(byPath.get('src/main/cpp/Robot.cpp')?.kind).toBe('cpp');
      expect(byPath.get('src/main/deploy/pathplanner/paths/Center.path')?.kind).toBe('pathplanner');
      expect(byPath.get('ascope_assets/robot.glb')).toMatchObject({
        binary: true,
        kind: 'asset',
        size: 4,
      });
      expect(byPath.get('vendordeps/Phoenix6.json')?.format).toBe('FRC vendor dependency');
      expect(byPath.has('build/generated/Bogus.java')).toBe(false);
      expect(byPath.has('logs/replay.wpilog')).toBe(false);
    } finally {
      await service.close();
    }
  });

  it('recognizes Gradle Kotlin and WPILib-style C++ workspaces as FRC projects', async () => {
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-detect-state-'));
    const store = new SettingsStore(path.join(stateRoot, 'state.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      const kotlinRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-kotlin-'));
      await writeFile(path.join(kotlinRoot, 'build.gradle.kts'), 'plugins {}', 'utf8');
      expect((await service.inspectDirectory(kotlinRoot)).kind).toBe('frc-project');

      const cppRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-cpp-'));
      await writeFile(path.join(cppRoot, 'CMakeLists.txt'), 'project(Robot)', 'utf8');
      expect((await service.inspectDirectory(cppRoot)).kind).toBe('frc-project');
      const openedCpp = await service.open(cppRoot);
      expect(openedCpp).toMatchObject({
        mode: 'source',
        sourceBrowseOnly: true,
      });
      expect(openedCpp.model?.subsystems).toEqual([]);
      expect(openedCpp.sourceFiles.map((file) => file.path)).toContain('CMakeLists.txt');
    } finally {
      await service.close();
    }
  });

  it('resolves external managed-code changes only through reviewed conflict actions', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-service-conflict-'));
    const stateRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-conflict-state-'));
    const model = createEmptyProject({
      javaPackage: 'frc.robot',
      name: 'Conflict Test',
      teamNumber: 10541,
      wpilibYear: 2026,
    });
    await writeFile(path.join(root, 'project.yaml'), stringifyProjectYaml(model), 'utf8');
    const store = new SettingsStore(path.join(stateRoot, 'state.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      await service.open(root);
      const shooterId = createEntityId();
      const add = await service.previewCommand({
        collection: 'subsystems',
        entity: {
          displayName: 'Shooter',
          id: shooterId,
          kind: 'subsystem',
          symbol: 'Shooter',
        },
        type: 'add',
      });
      await service.applyPreview(add.id);
      const relative = 'src/main/java/frc/robot/subsystems/shooter/Shooter.java';
      const sourcePath = path.join(root, relative);
      const external = (await readFile(sourcePath, 'utf8')).replace(
        '// No hardware devices or child nodes are configured for this subsystem.',
        '// EXTERNAL MANAGED EDIT',
      );
      await writeFile(sourcePath, `${external}\nfinal class TeamOwnedHelper {}\n`, 'utf8');

      const compare = await service.resolveExternal({ action: 'compare', paths: [relative] });
      expect(compare.preview?.changes.some((change) => change.path === relative)).toBe(true);
      expect(
        compare.preview?.changes
          .find((change) => change.path === relative)
          ?.lines.some((line) => line.text.includes('EXTERNAL MANAGED EDIT')),
      ).toBe(true);
      if (compare.preview === undefined) throw new Error('Expected compare preview.');
      await service.discardPreview(compare.preview.id);

      const keep = await service.resolveExternal({ action: 'keep-code', paths: [relative] });
      if (keep.preview === undefined) throw new Error('Expected keep-code preview.');
      const unmanaged = await service.applyPreview(keep.preview.id);
      expect(unmanaged.model?.unmanagedFiles).toContain(relative);
      expect(await readFile(sourcePath, 'utf8')).toContain('EXTERNAL MANAGED EDIT');

      const mechanism = await service.previewCommand({
        collection: 'subsystems',
        entity: {
          displayName: 'Upper',
          id: createEntityId(),
          kind: 'mechanism',
          parentId: shooterId,
          symbol: 'Upper',
        },
        type: 'add',
      });
      expect(mechanism.changes.some((change) => change.path === relative)).toBe(false);
      await service.discardPreview(mechanism.id);

      const regenerate = await service.resolveExternal({ action: 'regenerate', paths: [relative] });
      if (regenerate.preview === undefined) throw new Error('Expected regenerate preview.');
      expect(regenerate.preview.changes.some((change) => change.path === relative)).toBe(true);
      const managed = await service.applyPreview(regenerate.preview.id);
      expect(managed.model?.unmanagedFiles).not.toContain(relative);
      expect(await readFile(sourcePath, 'utf8')).not.toContain('EXTERNAL MANAGED EDIT');
    } finally {
      await service.close();
    }
  });
});

async function writeStructuredFixture(
  root: string,
  model: ReturnType<typeof createEmptyProject>,
): Promise<void> {
  await writeFile(path.join(root, 'project.yaml'), stringifyProjectYaml(model), 'utf8');
  for (const [relativePath, content] of generateStructuredFiles(model)) {
    const outputPath = path.join(root, relativePath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, content);
  }
}
