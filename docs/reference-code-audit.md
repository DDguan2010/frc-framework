# Reference code architecture and reuse audit

Date: 2026-07-17

## `frc-code-base`

The base repository is a 2026 Java command-based GradleRIO project. Its robot-specific code lives
under `frc.robot`; reusable code is grouped under `lib.ironpulse`, and the NetworkTables annotation
processor is currently mixed into the main source set. It includes AdvantageKit, Phoenix 6,
PathPlanner, WPILib New Commands, Spotless, Lombok, JGraphT, and JAMA.

Useful reusable seams:

- `lib.ironpulse.io`: real/sim motor and sensor IO boundaries;
- `lib.ironpulse.subsystem`: generic motor, position, and velocity mechanisms;
- `lib.ironpulse.swerve` and `lib.ironpulse.limelight`: valuable preset source material, but too
  specific and dependency-heavy for an empty base;
- `lib.ntext`: annotation, wrapper, registry, and annotation processor for generated NT access;
- Phoenix signal synchronization, logging, filter, and utility classes where a generated feature
  actually needs them.

Items requiring refactoring before reuse:

- the base contains example Swerve and mechanism files, so it is not truly empty;
- a Swerve class imports a robot-package generated parameter class, reversing the desired library
  dependency direction;
- `lib.ntext` belongs in `src/ext`, compiled before `main`, rather than in the robot source tree;
- several IronPulse types expose many useful parameters but mix naming conventions, defaults, and
  robot assumptions; the catalog must describe these explicitly;
- the checked-out base does not currently compile because `SwerveModuleParamsNT` is imported from
  the wrong package. It is a reference, not the new template.

## `2026-offseason-robot-10541`

The robot lifecycle is conventional and sound: `Main` starts `Robot`, `Robot` configures
AdvantageKit/NT and runs `CommandScheduler`, and `RobotContainer` constructs the robot. Autonomous
selection is exposed through `getAutonomousCommand()` and cancelled at teleop entry.

The project demonstrates useful real-world organization:

- `auto/AutoActions`, `AutoFile`, `AutoParams`, and `AutoRoutines` separate reusable actions,
  persisted selection, tunable inputs, and composed routines;
- `subsystems/<Mechanism>` co-locates a mechanism, its config, state behavior, and supporting math;
- a Shooter superstructure coordinates upper/lower flywheels, hood, hopper, and Swerve;
- `FieldPublisher`, `RobotMechanism3d`, and state recorder classes keep visualization outside the
  mechanism classes;
- real/sim IO selection is explicit and controllers use WPILib command triggers.

The main scaling problem is `RobotContainer`: it builds every device, owns controllers, declares
bindings, configures default commands, initializes auto, and starts telemetry helpers. The new base
keeps it as a readable composition root but moves those responsibilities into `controls`,
`commands`, `auto`, and `telemetry` packages.

## Reuse decision

| Asset | Decision | Reason |
| --- | --- | --- |
| WPILib Gradle wrapper and standard project metadata | Reuse, unmodified | Standard build bootstrap; covered by the WPILib BSD license. |
| WPILib command lifecycle shape | Reimplement from the official template | Small, clearer, and avoids robot-specific behavior. |
| `lib.ntext` | Reuse in `src/ext`, with notices | Self-contained and required for generated parameters. |
| IronPulse motor IO/config concepts | Rewrite a minimal core, then add audited modules on demand | Keeps the empty base compiling and removes robot-package coupling. |
| IronPulse Swerve and Limelight | Preset-only | They should appear only when selected. |
| 10541 subsystem/command/auto logic | Do not put in Base | Robot-specific behavior remains reference material. |
| AdvantageKit/Phoenix/PathPlanner vendordeps | Reuse metadata | Required foundation; versions are explicit per WPILib year. |
| Deploy paths, robot models, Elastic layouts | Do not put in Base | Team/robot-specific assets. |

## Copyright and license

Both local projects contain `WPILib-License.md`, the three-clause WPILib BSD license. Files copied
from WPILib retain their copyright headers. Mechanical Advantage-derived utilities carry their own
MIT-style headers; those files are not included in the initial Base and must retain the header and
MIT notice if a later preset uses them. Generated robot code includes the WPILib BSD license. The
new IronPulse core in this repository is a clean rewrite based on public interfaces and the user's
configuration goals, not a line-for-line copy.
