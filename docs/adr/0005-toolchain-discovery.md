# ADR 0005: WPILib toolchain discovery and process abstraction

- Status: Accepted
- Date: 2026-07-17

## Context

FRC projects must build with the Java version expected by their GradleRIO year. A user's system Java
can differ from the JDK installed by WPILib, and installer paths differ between Windows and Unix-like
systems. Build, simulation, and deploy output must be cancellable and visible in the desktop UI.

## Decision

Discover Java in this order: a project-specific explicit selection, the matching WPILib year's JDK,
other WPILib JDKs from newest to oldest, `JAVA_HOME`, then `PATH`. Probe every candidate with
`java -version`, retain incompatible candidates as diagnostics, and select only a compatible version.
For 2024–2026 projects the required major version is Java 17.

Search `%PUBLIC%\\wpilib\\YYYY\\jdk` and the user's `wpilib` directory on Windows, and
`~/wpilib/YYYY/jdk` on macOS/Linux. These locations follow the official WPILib installer layout.

Run the project Gradle wrapper with Node `spawn`, never a Renderer shell. Unix invokes `gradlew`
directly; Windows invokes `gradlew.bat` through an explicit hidden `cmd.exe` process with quoted,
single-line arguments. All calls add plain console output and no-daemon mode, stream stdout/stderr,
accept `AbortSignal`, enforce a timeout, return exit/signal information, and parse compiler locations.

## Consequences

The UI can explain why a JDK was selected or rejected and can show file-linked build errors. The
process abstraction is reusable for tasks, compilation, simulation, and deployment. Future WPILib
years must update the Java compatibility catalog rather than assuming an arbitrary system JDK works.

## References

- WPILib Installation Guide, official installer layout and bundled JDK
- WPILib JVM Runtime documentation, selecting the WPILib JDK for Gradle
