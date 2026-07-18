# Release process

FRC Framework builds independently on Windows, macOS, and Linux because Electron Forge makers
must run on their target host.

## GitHub Actions release

Open **Actions → Build and publish release → Run workflow**, enter a version such as `0.2.0`, and
run it from the branch to publish. The workflow validates the version, updates both package files for
the build, runs the complete check suite, builds each platform on its native runner, and creates the
`v<version>` GitHub Release. The public Release contains only the Windows Setup EXE, macOS DMG, Linux
DEB, and Linux RPM installers. Portable archives, checksums, SBOMs, dependency licenses, and maker
intermediate files remain available in the workflow's Actions artifacts without cluttering the
public download list. Do not include the leading `v` in the input.

The workflow itself is the release authority; a normal local `git commit` intentionally has no
project hook and does not run checks. CI and the release workflow remain responsible for validation.

## Local artifacts

```bash
pnpm check
pnpm make
pnpm release:metadata
```

Windows produces a Squirrel installer and ZIP, macOS produces DMG and ZIP, and Linux produces DEB,
RPM, and ZIP. `output/release/<platform>-<architecture>` contains `SHA256SUMS`, an SPDX 2.3 SBOM,
and the production dependency license inventory. These complete outputs are retained as Actions
artifacts; only native installers are copied to the GitHub Release.

## Signing secrets

Unsigned local builds remain possible. Release CI may enable signing entirely through secrets:

- Windows: `WINDOWS_CERTIFICATE_FILE` and `WINDOWS_CERTIFICATE_PASSWORD`. The certificate path
  points to a PFX made available only to the Windows runner.
- macOS signing: `APPLE_IDENTITY` names an installed Developer ID Application identity.
- macOS notarization: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` are required in
  addition to the signing identity.

Never store signing material in the repository or release artifacts. Confirm signatures with
`Get-AuthenticodeSignature` on Windows and `codesign --verify --deep --strict` plus
`spctl --assess --type execute` on macOS before publication.

## Versions and updates

Application versions are kept in the root and desktop `package.json` files. Schema, Base, Preset API,
and installed preset versions are visible in About. The application only checks the latest GitHub
Release when the user presses **Check for updates**; it does not download or install updates.

Update `CHANGELOG.md`, run the release workflow with the intended version, and publish only after every
checksum, smoke test, and installer has passed. The workflow creates the `v<version>` tag and Release;
do not create a competing tag manually.
