import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { validateModel } from '@frc-framework/domain';

import { JavaProjectIndexer } from './project-indexer.js';

const indexers: JavaProjectIndexer[] = [];

afterEach(() => {
  indexers.splice(0).forEach((indexer) => indexer.dispose());
});

describe('JavaProjectIndexer', () => {
  it('infers metadata, hierarchy, controllers, commands, bindings, and reuses unchanged indexes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-import-'));
    const source = path.join(root, 'src/main/java/frc/robot/subsystems/Shooter');
    await mkdir(source, { recursive: true });
    const autoSource = path.join(root, 'src/main/java/frc/robot/auto');
    await mkdir(autoSource, { recursive: true });
    await mkdir(path.join(root, '.wpilib'), { recursive: true });
    await writeFile(
      path.join(root, 'build.gradle'),
      'plugins { id "edu.wpi.first.GradleRIO" version "2026.2.1" }\n',
      'utf8',
    );
    await writeFile(
      path.join(autoSource, 'CompetitionAutos.java'),
      `package frc.robot.auto;
       import edu.wpi.first.wpilibj2.command.Command;
       public final class CompetitionAutos {
         public static Command centerFourPiece() { return null; }
       }
      `,
      'utf8',
    );
    await writeFile(
      path.join(root, '.wpilib/wpilib_preferences.json'),
      '{"teamNumber":10541}\n',
      'utf8',
    );
    await writeFile(
      path.join(source, 'UpperShooter.java'),
      `package frc.robot.subsystems.Shooter;
       import edu.wpi.first.wpilibj2.command.Command;
       import edu.wpi.first.wpilibj2.command.button.CommandXboxController;
       import lib.ironpulse.io.MotorIOTalonFX;
       public class UpperShooter {
         private final MotorIOTalonFX upperMotor = new MotorIOTalonFX(null);
         private final CommandXboxController driver = new CommandXboxController(0);
         public UpperShooter() {
           driver.a().onTrue(shoot());
           driver.a().onTrue(shoot(4500));
         }
         public Command shoot() { return null; }
         public Command shoot(int rpm) { return null; }
       }
      `,
      'utf8',
    );
    const indexer = await JavaProjectIndexer.create();
    indexers.push(indexer);
    const first = await indexer.indexProject(root);
    expect(first.model.project.teamNumber).toBe(10541);
    expect(first.model.project.wpilibYear).toBe(2026);
    expect(first.model.subsystems.map((entry) => entry.displayName)).toEqual(
      expect.arrayContaining(['Shooter', 'UpperShooter']),
    );
    expect(first.model.devices[0]?.symbol).toBe('UpperMotor');
    expect(first.model.controllers[0]?.provider).toBe('CommandXboxController');
    expect(first.model.commands.some((command) => command.symbol === 'shoot')).toBe(true);
    expect(first.model.bindings).toHaveLength(2);
    expect(first.model.commands).toHaveLength(3);
    expect(first.model.autos.map((auto) => auto.symbol)).toEqual(['centerFourPiece']);
    expect(new Set(first.model.commands.map((command) => command.id)).size).toBe(3);
    expect(
      validateModel(first.model).filter((problem) =>
        ['duplicate-binding', 'duplicate-entity-id'].includes(problem.code),
      ),
    ).toEqual([]);
    const second = await indexer.indexProject(root);
    expect(second.cacheHits).toBe(2);
    expect(second.parsedFiles).toBe(0);
  });

  it('keeps incomplete source in a partial report instead of failing the project', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-partial-'));
    const source = path.join(root, 'src/main/java/frc/robot/subsystems/Arm');
    await mkdir(source, { recursive: true });
    await writeFile(
      path.join(source, 'Arm.java'),
      'package frc.robot.subsystems.Arm; public class Arm { void x( {',
      'utf8',
    );
    const indexer = await JavaProjectIndexer.create();
    indexers.push(indexer);
    const report = await indexer.indexProject(root);
    expect(report.partialFiles).toHaveLength(1);
    expect(report.files[0]?.path).toContain('Arm.java');
  });
});
