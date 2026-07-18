# @frc-framework/test-fixtures

Golden FRC projects and parser/generator fixtures live here.

The executable fixture definitions and full-project SHA-256 map digests are maintained in
`packages/code-generator/src/generator.test.ts`. They cover an empty Base, one TalonFX subsystem, a
nested goal-driven Shooter, and Swerve + Limelight. The same suite has an opt-in real WPILib Gradle
matrix (`FRC_FRAMEWORK_RUN_BASE_INTEGRATION=1`) that compiles those branches plus common presets.

`packages/java-parser/src/reference-projects.test.ts` pins the source-only import inventory for the
local 2026 offseason 10541 project so recognition drift is intentional and reviewed.
