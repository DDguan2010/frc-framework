# Generated Robot Project Architecture

FRC Framework generates ordinary WPILib command-based Java. The application is an editor and
code generator, not a runtime dependency.

## Responsibility boundaries

- `RobotContainer.java` is the composition root. It constructs child mechanisms before their
  parents, connects dependencies, registers PathPlanner named commands, and configures controls.
- `controls/OperatorInterface.java` declares controllers and simple trigger bindings. Complex
  analog or multi-condition input logic may remain custom Java in this package.
- `commands/RobotCommands.java` contains command factories that coordinate more than one
  subsystem or mechanism.
- `auto/` owns autonomous choices and PathPlanner command registration.
- `telemetry/` owns field and robot-wide telemetry.
- `subsystems/<tree path>/<Node>.java` owns runtime Goal state, default commands, local command
  factories, sensor behavior, and typed child accessors.
- `subsystems/<tree path>/<Node>Config.java` owns CAN bus/ID, inversion, neutral mode, ratios,
  current limits, PID/feedforward, limits, zeroing, follower, simulation, and live tuning
  configuration for motors directly owned by that node.
- `tuning/TuningParameters.java` is the typed NetworkTables value registry generated from
  `project.yaml`.

This follows the same broad boundary used in the 10541 reference robot: static hardware and tuning
construction are separated from runtime subsystem/superstructure behavior. FRC Framework does not
generate a separate Commands class for every small mechanism. Local commands stay beside their
Goal logic; only cross-subsystem orchestration moves to `RobotCommands`.

## Example

```text
subsystems/
  shooter/
    Shooter.java                    # superstructure Goal and child coordination
    upperFlywheel/
      UpperFlywheel.java            # Goal, default velocity command, atGoal()
      UpperFlywheelConfig.java      # leader/follower CAN and velocity gains
    lowerFlywheel/
      LowerFlywheel.java
      LowerFlywheelConfig.java
    shooterHood/
      ShooterHood.java              # position Goal and homing command
      ShooterHoodConfig.java        # limits, zeroing, gains and simulation
```

Every generated runtime node extends `SubsystemBase`. Goal-changing commands require that node,
while each `MotorSubsystem` owns the actual motor control command. This keeps WPILib scheduling
explicit and allows a mechanism to be tested independently.

When a Swerve preset and a supported driver controller are both present, `RobotContainer`
automatically installs the field-relative teleop drive Default Command. `OperatorInterface`
provides shaped forward/left/rotation suppliers using the controller's deadband, scale, and axis
inversion settings. Xbox, PS4, PS5, CommandJoystick, and CommandGenericHID mappings are generated;
custom controller providers remain explicit Java so the application never guesses their axes.

## Acceptance robot

Run the complete generator acceptance scenario with:

```bash
pnpm test:acceptance-robot
```

It creates `output/acceptance-robot`, then formats and compiles a robot containing Swerve,
Limelight, nested intake and shooter mechanisms, followers, position zeroing, Beam Break, LED,
NetworkTables parameters, two controllers, bindings, cross-subsystem commands, PathPlanner named
commands, Auto, telemetry, docs, and `project.yaml`. It also re-indexes the generated Java and
checks that Config files are not misidentified as subsystem tree nodes.
