import { FuseV1Options, FuseVersion } from '@electron/fuses';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { VitePlugin } from '@electron-forge/plugin-vite';
import path from 'node:path';

const windowsCertificate = process.env.WINDOWS_CERTIFICATE_FILE;
const windowsCertificatePassword = process.env.WINDOWS_CERTIFICATE_PASSWORD;
const appleIdentity = process.env.APPLE_IDENTITY;
const appleId = process.env.APPLE_ID;
const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
const appleTeamId = process.env.APPLE_TEAM_ID;

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    appCopyright: 'Copyright © 2026 0.2Studio',
    executableName: 'frc-framework',
    icon: path.resolve(import.meta.dirname, '../../resources/icons/icon'),
    extraResource: [
      path.resolve(import.meta.dirname, '../../resources'),
      path.resolve(
        import.meta.dirname,
        '../../node_modules/tree-sitter-wasms/out/tree-sitter-java.wasm',
      ),
      path.resolve(import.meta.dirname, '../../node_modules/web-tree-sitter/tree-sitter.wasm'),
    ],
    ...(appleIdentity === undefined
      ? {}
      : {
          osxSign: { identity: appleIdentity },
          ...(appleId === undefined || appleIdPassword === undefined || appleTeamId === undefined
            ? {}
            : {
                osxNotarize: {
                  appleId,
                  appleIdPassword,
                  teamId: appleTeamId,
                },
              }),
        }),
    ...(windowsCertificate === undefined
      ? {}
      : {
          windowsSign: {
            certificateFile: windowsCertificate,
            ...(windowsCertificatePassword === undefined
              ? {}
              : { certificatePassword: windowsCertificatePassword }),
            description: 'FRC Framework',
          },
        }),
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      authors: '0.2Studio',
      ...(windowsCertificate === undefined ? {} : { certificateFile: windowsCertificate }),
      ...(windowsCertificatePassword === undefined
        ? {}
        : { certificatePassword: windowsCertificatePassword }),
      name: 'frc_framework',
      setupIcon: path.resolve(import.meta.dirname, '../../resources/icons/icon.ico'),
    }),
    new MakerDMG({ icon: path.resolve(import.meta.dirname, '../../resources/icons/icon.icns') }, [
      'darwin',
    ]),
    new MakerZIP({}, ['darwin', 'linux', 'win32']),
    new MakerRpm({
      options: {
        bin: 'frc-framework',
        license: 'Proprietary',
        name: 'frc-framework',
        productName: 'FRC Framework',
      },
    }),
    new MakerDeb({
      options: {
        bin: 'frc-framework',
        name: 'frc-framework',
        productName: 'FRC Framework',
      },
    }),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
