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
    const upperShooter = first.model.subsystems.find(
      (subsystem) => subsystem.symbol === 'UpperShooter',
    );
    expect(upperShooter).toBeDefined();
    expect(
      first.model.commands
        .filter((command) => command.symbol === 'shoot')
        .every((command) => command.requirementIds[0] === upperShooter?.id),
    ).toBe(true);
    expect(
      first.model.commands.find((command) => command.symbol === 'centerFourPiece')?.requirementIds,
    ).toEqual([]);
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

  it('recognizes handwritten subsystem inheritance, state goals, command classes, and HID ports', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-handwritten-'));
    const subsystemSource = path.join(root, 'src/main/java/frc/robot/subsystems/Arm');
    const subsystemCommandSource = path.join(subsystemSource, 'commands');
    const commandSource = path.join(root, 'src/main/java/frc/robot/commands');
    await mkdir(subsystemCommandSource, { recursive: true });
    await mkdir(commandSource, { recursive: true });
    await writeFile(
      path.join(subsystemSource, 'ArmSubsystem.java'),
      `package frc.robot.subsystems.Arm;
       import edu.wpi.first.wpilibj2.command.SubsystemBase;
       public final class ArmSubsystem extends SubsystemBase {
         enum Goal { STOW, INTAKE, SCORE }
       }`,
      'utf8',
    );
    await writeFile(
      path.join(subsystemSource, 'ShotCalculator.java'),
      'package frc.robot.subsystems.Arm; public final class ShotCalculator {}',
      'utf8',
    );
    await writeFile(
      path.join(commandSource, 'ScoreCommand.java'),
      `package frc.robot.commands;
       import edu.wpi.first.wpilibj2.command.Command;
       public final class ScoreCommand implements Command {}`,
      'utf8',
    );
    await writeFile(
      path.join(subsystemCommandSource, 'HoldArmCommand.java'),
      `package frc.robot.subsystems.Arm.commands;
       import edu.wpi.first.wpilibj2.command.Command;
       public final class HoldArmCommand implements Command {}`,
      'utf8',
    );
    await writeFile(
      path.join(root, 'src/main/java/frc/robot/RobotContainer.java'),
      `package frc.robot;
       import edu.wpi.first.wpilibj2.command.button.CommandXboxController;
       public final class RobotContainer {
         private final CommandXboxController operator = new CommandXboxController(4);
       }`,
      'utf8',
    );

    const indexer = await JavaProjectIndexer.create();
    indexers.push(indexer);
    const report = await indexer.indexProject(root);
    const arm = report.model.subsystems.find((entry) => entry.symbol === 'ArmSubsystem');
    expect(arm?.stateMachine?.states.map((state) => state.symbol)).toEqual([
      'STOW',
      'INTAKE',
      'SCORE',
    ]);
    expect(arm?.behaviorMode).toBe('goal-driven');
    expect(report.model.subsystems.some((entry) => entry.symbol === 'ShotCalculator')).toBe(false);
    expect(report.model.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          factory: false,
          javaFile: 'src/main/java/frc/robot/commands/ScoreCommand.java',
          requirementIds: [],
          symbol: 'ScoreCommand',
        }),
        expect.objectContaining({
          factory: false,
          javaFile: 'src/main/java/frc/robot/subsystems/Arm/commands/HoldArmCommand.java',
          requirementIds: [arm?.id],
          symbol: 'HoldArmCommand',
        }),
      ]),
    );
    expect(report.model.controllers[0]?.port).toBe(4);
    expect(report.model.unmanagedFiles).toEqual(
      expect.arrayContaining([
        'src/main/java/frc/robot/RobotContainer.java',
        'src/main/java/frc/robot/commands/ScoreCommand.java',
        'src/main/java/frc/robot/subsystems/Arm/ArmSubsystem.java',
      ]),
    );
  });

  it('recovers an arbitrarily deep generated subsystem tree from Java paths', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-nested-import-'));
    const source = path.join(root, 'src/main/java/frc/robot/subsystems/intake');
    const pivotSource = path.join(source, 'intakePivot');
    const sensorSource = path.join(pivotSource, 'zeroSensorLogic');
    await mkdir(sensorSource, { recursive: true });
    await writeFile(
      path.join(source, 'Intake.java'),
      'package frc.robot.subsystems.intake; public class Intake {}',
      'utf8',
    );
    await writeFile(
      path.join(pivotSource, 'IntakePivot.java'),
      'package frc.robot.subsystems.intake.intakePivot; public class IntakePivot {}',
      'utf8',
    );
    await writeFile(
      path.join(pivotSource, 'IntakePivotConfig.java'),
      'package frc.robot.subsystems.intake.intakePivot; public class IntakePivotConfig {}',
      'utf8',
    );
    await writeFile(
      path.join(sensorSource, 'ZeroSensorLogic.java'),
      'package frc.robot.subsystems.intake.intakePivot.zeroSensorLogic; public class ZeroSensorLogic {}',
      'utf8',
    );

    const indexer = await JavaProjectIndexer.create();
    indexers.push(indexer);
    const report = await indexer.indexProject(root);
    const intake = report.model.subsystems.find((entry) => entry.symbol === 'Intake');
    const pivot = report.model.subsystems.find((entry) => entry.symbol === 'IntakePivot');
    const sensor = report.model.subsystems.find((entry) => entry.symbol === 'ZeroSensorLogic');
    expect(intake?.parentId).toBeUndefined();
    expect(pivot?.parentId).toBe(intake?.id);
    expect(sensor?.parentId).toBe(pivot?.id);
    expect(pivot?.javaFile).toBe(
      'src/main/java/frc/robot/subsystems/intake/intakePivot/IntakePivot.java',
    );
    expect(sensor?.javaFile).toBe(
      'src/main/java/frc/robot/subsystems/intake/intakePivot/zeroSensorLogic/ZeroSensorLogic.java',
    );
    expect(report.model.subsystems.some((entry) => entry.symbol === 'IntakePivotConfig')).toBe(
      false,
    );
  });
});
