# Known limitations

- Code signing and Apple notarization occur only when the release runner has the documented secrets;
  local artifacts are unsigned by default.
- Update checking is advisory. Automatic download and installation are intentionally disabled until
  signed rollback has been exercised on all three operating systems.
- NetworkTables calibration requires the robot to be in Driver Station Test Enabled mode. The desktop
  request and generated robot code both limit ordinary direction tests to 15 percent output and two
  seconds, but physical safety remains the operator's responsibility.
- Source-only import is conservative. Handwritten Java is indexed as a read-only overlay; structures
  that cannot be proven safe remain custom/unmanaged and should be edited in an IDE. Kotlin and C++
  projects can be opened and browsed, but their structure is not yet generated from `project.yaml`.
- Preset-generated files with user-owned regions are preserved. A whole file deliberately marked
  unmanaged will no longer receive generated updates until it is explicitly managed again.
- FRC Framework currently targets WPILib 2026 and the vendordep versions emitted by Base version 1.
