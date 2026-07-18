import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { generateStructuredFiles } from '@frc-framework/code-generator';
import { createEmptyProject, createEntityId } from '@frc-framework/domain';
import { instantiateCommonPreset, instantiateSwervePreset } from '@frc-framework/presets';
import { stringifyProjectYaml } from '@frc-framework/project-io';
import { describe, expect, it } from 'vitest';

import { ProjectService } from './project-service.js';
import { SettingsStore } from './settings-store.js';

describe('ProjectService structured edits', () => {
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
