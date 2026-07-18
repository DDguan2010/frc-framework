import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { JavaParserService } from './java-parser.js';

let parser: JavaParserService;

beforeAll(async () => {
  parser = await JavaParserService.create();
});

afterAll(() => {
  parser.dispose();
});

describe('JavaParserService', () => {
  it('indexes packages, symbols, commands, controllers, bindings, and goals', () => {
    const source = `
      package frc.robot;

      import edu.wpi.first.wpilibj2.command.Command;
      import edu.wpi.first.wpilibj2.command.button.CommandXboxController;
      import lib.ironpulse.io.MotorIOTalonFX;

      public class RobotContainer {
        private final CommandXboxController driverController = new CommandXboxController(0);
        private final MotorIOTalonFX shooterMotor = new MotorIOTalonFX(null);

        public RobotContainer() {
          driverController.a().onTrue(shootCommand());
        }

        public Command shootCommand() { return null; }
      }

      enum ShooterGoal { IDLE, SPEAKER }
    `;

    const index = parser.index(source);

    expect(index.packageName).toBe('frc.robot');
    expect(index.imports).toHaveLength(3);
    expect(index.types.map((type) => type.name)).toEqual(['RobotContainer', 'ShooterGoal']);
    expect(index.controllers).toEqual([
      expect.objectContaining({
        controllerType: 'CommandXboxController',
        fieldName: 'driverController',
        port: 0,
      }),
    ]);
    expect(index.commandMethods).toEqual([
      expect.objectContaining({ name: 'shootCommand', returnType: 'Command' }),
    ]);
    expect(index.bindings).toEqual([
      expect.objectContaining({
        commandExpression: 'shootCommand()',
        event: 'onTrue',
        triggerExpression: 'driverController.a()',
      }),
    ]);
    expect(index.states).toEqual([expect.objectContaining({ name: 'ShooterGoal', role: 'goal' })]);
    expect(index.patterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ family: 'ironpulse', symbol: 'MotorIOTalonFX' }),
        expect.objectContaining({ family: 'controller' }),
        expect.objectContaining({ family: 'wpilib-command' }),
      ]),
    );
    expect(index.ownership.classification).toBe('recognized');
    expect(index.hasSyntaxErrors).toBe(false);
  });

  it('indexes inheritance, field initializers, enum values, and non-zero controller ports', () => {
    const index = parser.index(`
      package frc.robot.subsystems.arm;
      import edu.wpi.first.wpilibj2.command.SubsystemBase;
      import edu.wpi.first.wpilibj2.command.button.CommandPS5Controller;

      public final class ArmSubsystem extends SubsystemBase implements AutoCloseable {
        private final CommandPS5Controller operator = new CommandPS5Controller(3);
        enum Goal { STOW, INTAKE, SCORE }
        @Override public void close() {}
      }
    `);

    expect(index.types[0]).toMatchObject({
      enumConstants: [],
      extendsTypes: ['SubsystemBase'],
      implementsTypes: ['AutoCloseable'],
      name: 'ArmSubsystem',
    });
    expect(index.types.find((type) => type.name === 'Goal')?.enumConstants).toEqual([
      'STOW',
      'INTAKE',
      'SCORE',
    ]);
    expect(index.controllers[0]).toMatchObject({
      controllerType: 'CommandPS5Controller',
      fieldName: 'operator',
      port: 3,
    });
    expect(index.states[0]).toMatchObject({
      name: 'Goal',
      role: 'goal',
      values: ['STOW', 'INTAKE', 'SCORE'],
    });
  });

  it('keeps useful symbols when Java is temporarily incomplete', () => {
    const index = parser.index(`
      package frc.robot;
      public class BrokenSubsystem {
        public void periodic() {
          if (true) {
      }
    `);

    expect(index.hasSyntaxErrors).toBe(true);
    expect(index.types[0]?.name).toBe('BrokenSubsystem');
    expect(index.problems.length).toBeGreaterThan(0);
    expect(index.ownership.classification).toBe('custom');
  });

  it('gives managed markers priority while reporting syntax health', () => {
    const index = parser.index(`
      package frc.robot;
      // <frc-framework:managed id="config">
      final class Config {}
      // </frc-framework:managed>
    `);

    expect(index.ownership).toEqual(
      expect.objectContaining({ classification: 'managed', confidence: 1 }),
    );
  });
});
