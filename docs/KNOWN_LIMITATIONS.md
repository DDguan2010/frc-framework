# Known limitations

- Code signing and Apple notarization occur only when the release runner has the documented secrets;
  local artifacts are unsigned by default.
- Update checking is advisory. Automatic download and installation are intentionally disabled until
  signed rollback has been exercised on all three operating systems.
- NetworkTables calibration requires the robot to be in Driver Station Test Enabled mode. The desktop
  request and generated robot code both limit ordinary direction tests to 15 percent output and two
  seconds, but physical safety remains the operator's responsibility.
- Source-only import is conservative. Unrecognized Java stays custom/unmanaged and may need manual
  documentation before it can be represented structurally.
- Preset-generated files with user-owned regions are preserved. A whole file deliberately marked
  unmanaged will no longer receive generated updates until it is explicitly managed again.
- FRC Framework currently targets WPILib 2026 and the vendordep versions emitted by Base version 1.
