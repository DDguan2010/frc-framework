# Changelog

All notable changes to FRC Framework will be documented in this file. The format follows Keep a
Changelog, and versions follow Semantic Versioning while the application remains pre-1.0.

## [Unreleased]

### Added

- Complete Electron Forge, Vite, TypeScript, Lit, and official Material Web desktop workspace.
- Structured project model, versioned YAML, transactional Diff/apply/undo, crash recovery, migration
  backup, and conservative source-only import.
- Readable WPILib Java Base generation with IronPulse hardware configuration, nested subsystem trees,
  goal state scaffolds, commands, controller bindings, autonomous routines, telemetry, and English docs.
- Versioned Swerve, Limelight, percent-output, flywheel, position, beam-break, and LED presets.
- NetworkTables live comparison, typed write-back, snapshots, calibration checks, guarded low-power
  tests, and WPILib SysId entry points.
- Problems aggregation, safe Quick Fix, exact IDE navigation, external edit conflict resolution, and
  build/simulate/deploy diagnostics.
- English and Simplified Chinese UI, accessible keyboard navigation, packaged smoke/E2E tests, and
  Windows/macOS/Linux installer pipelines.
- About version inventory, advisory GitHub Releases update checking, SHA-256 manifests, SPDX SBOM, and
  dependency license metadata.
- Native Windows, macOS, and Linux GitHub Release workflow driven by one version input.
- Bilingual preset summaries, quick-start guidance, recommended defaults, and parameter descriptions.
- Incremental live Java indexing so externally added or removed Commands and Autos update in the UI.
- A Java source file, direct hardware ownership, local Goals, and typed parent composition for every
  subsystem-tree node at arbitrary depth.
- IronPulse Catalog v2 compatibility for the current 10541 remote CANcoder, zeroing, Motion Magic,
  unit-based motor IO, and runtime configuration surface.

### Fixed

- PathPlanner and AdvantageScope launchers now support automatic or custom application paths;
  Windows automatic detection includes the Microsoft Store PathPlanner package.
- Per-project editor choices are stored locally and no longer create robot-code previews or modify
  `project.yaml`.
- Source import gives overloaded Command methods unique stable IDs, and controller validation allows
  one trigger/event to intentionally schedule multiple Commands while retaining requirement warnings.
- Preset instantiation no longer imports Node.js `crypto` into the renderer bundle.
- NetworkTables controls are now explicit, spacious, enabled by default, and refresh immediately after
  an applied change.
- Application and title-bar icons now preserve the source SVG transparency.
- Nested Mechanism code navigation now opens the selected node instead of its root subsystem, and
  nested nodes can be added to or removed from full-file Swerve/Limelight presets safely.
- `RobotCommands` receives the exact nested requirement, repeated device symbols are scoped to their
  owning Java class, and generated NT paths include the device name.
