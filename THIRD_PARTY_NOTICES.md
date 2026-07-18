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
