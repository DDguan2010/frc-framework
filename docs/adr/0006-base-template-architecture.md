# ADR 0006: One minimal, human-readable FRC base

- Status: Accepted
- Date: 2026-07-17

## Context

The application must create a useful robot project without making the output dependent on FRC
Framework. The reference projects prove useful IO, auto, and telemetry patterns, but their current
composition roots include robot-specific devices and too many responsibilities.

## Decision

Maintain exactly one `resources/base-template`. It is a normal GradleRIO Java project with a small
`Main`, `Robot`, `RobotContainer`, and `RobotConstants`. `RobotContainer` is only the composition
root. Controller binding lives in `controls/OperatorInterface`; cross-subsystem commands live in
`commands/RobotCommands`; autonomous code is split into Manager, Actions, Routines, and Params;
telemetry and field visualization have their own package.

The Base contains a clean, minimal IronPulse motor IO/config core and the ntext annotation processor
in `src/ext`. AdvantageKit, Phoenix 6, PathPlanner, WPILib New Commands, and Spotless are configured,
but no Swerve, Limelight, CAN device, controller instance, path, or robot-specific command exists.

Generated Java is deliberately ordinary: imports are explicit, constructors show dependencies,
there are no runtime framework hooks, and managed regions are small. A developer can delete
`project.yaml` and continue building and editing the project with WPILib tools.

## Consequences

Project creation is deterministic and fast. Features with larger dependency surfaces become
versioned presets. IronPulse can grow through catalogued modules without making every empty project
carry every robot implementation.
