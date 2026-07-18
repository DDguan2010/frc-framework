import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { generateStructuredFiles } from '@frc-framework/code-generator';
import { createEmptyProject, createEntityId, planSubsystemRemoval } from '@frc-framework/domain';
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
    const store = new SettingsStore(path.join(stateRoot, 'state.json'));
    await store.load();
    const service = new ProjectService(store, path.resolve('resources/base-template'));
    try {
      await service.open(root);
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
      await service.discardPreview(preview.id);
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
      const plan = planSubsystemRemoval(model, subsystemId);
      const preview = await service.previewCommand({
        changes: {
          autos: plan.model.autos,
          bindings: plan.model.bindings,
          commands: plan.model.commands,
          devices: plan.model.devices,
          presets: plan.model.presets,
          subsystems: plan.model.subsystems,
        },
        target: { scope: 'model' },
        type: 'update',
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
        '// No hardware devices are configured for this subsystem.',
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
