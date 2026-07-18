# Third-Party Notices

FRC Framework depends on the following direct production packages. Their transitive production
dependencies are checked by `pnpm licenses:check` on every full verification run.

| Package | Version | License | Purpose |
| --- | --- | --- | --- |
| Electron | 43.1.1 | MIT | Cross-platform desktop runtime |
| `@material/web` | 2.5.0 | Apache-2.0 | Official Material Design 3 web components |
| Lit | 3.3.3 | BSD-3-Clause | Renderer component model |
| `electron-squirrel-startup` | 1.0.1 | Apache-2.0 | Windows installer event handling |
| Roboto / Roboto Mono | Google Fonts snapshot | OFL-1.1 | Bundled offline UI and code fonts |
| Material Symbols Rounded | Google Material Icons snapshot | Apache-2.0 | Bundled offline application icons |

The complete license texts remain available in each installed package and in packaged application
resources produced by the release pipeline. Adding a production dependency with an unreviewed
license fails `pnpm licenses:check` until the license is explicitly evaluated.

## Acknowledgements and design references

The `lib.ironpulse` package organization and selected API concepts in the generated Base were
informed by the robot library maintained by FRC Team 6941, IronPulse Robotics (`ironpulse6941`):
<https://github.com/frc6941/lib-IP-2026>. Thank you to the team for sharing its architecture and
engineering ideas.

The upstream repository was reviewed at commit `51caf1287c07ec27eae1af40aa08366c4c27fa8d`.
Because it does not currently state a redistribution license for all original IronPulse sources,
FRC Framework does not bundle that repository wholesale. The compatibility sources shipped in the
Base are independently implemented and use only dependencies already present in generated robots.
