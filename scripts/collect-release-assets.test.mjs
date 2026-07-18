import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { collectReleaseAssets } from './collect-release-assets.mjs';

describe('public release asset collector', () => {
  it('publishes only native installers', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-release-'));
    try {
      const source = path.join(temporaryRoot, 'release-files');
      const destination = path.join(temporaryRoot, 'publish');
      await mkdir(path.join(source, 'nested'), { recursive: true });

      const files = new Map([
        ['FRC.Framework-1.0.0.Setup.exe', 'windows'],
        ['FRC.Framework-1.0.0-arm64.dmg', 'macos'],
        ['frc-framework_1.0.0_amd64.deb', 'debian'],
        ['frc-framework-1.0.0-1.x86_64.rpm', 'rpm'],
        ['FRC.Framework-win32-x64-1.0.0.zip', 'portable'],
        ['frc_framework-1.0.0-full.nupkg', 'updater'],
        ['RELEASES', 'updater-index'],
        ['win32-x64-SHA256SUMS', 'metadata'],
        ['win32-x64-sbom.spdx.json', 'metadata'],
      ]);
      for (const [name, contents] of files) {
        await writeFile(path.join(source, 'nested', name), contents, 'utf8');
      }

      const published = await collectReleaseAssets(source, destination);
      assert.deepEqual(published, [
        'FRC.Framework-1.0.0-arm64.dmg',
        'FRC.Framework-1.0.0.Setup.exe',
        'frc-framework-1.0.0-1.x86_64.rpm',
        'frc-framework_1.0.0_amd64.deb',
      ]);
      assert.deepEqual((await readdir(destination)).sort(), published);
      assert.equal(
        await readFile(path.join(destination, 'FRC.Framework-1.0.0.Setup.exe'), 'utf8'),
        'windows',
      );
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });

  it('fails rather than publishing an incomplete platform set', async () => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-release-'));
    try {
      const source = path.join(temporaryRoot, 'release-files');
      await mkdir(source, { recursive: true });
      await writeFile(path.join(source, 'FRC.Framework-1.0.0.Setup.exe'), 'windows', 'utf8');

      await assert.rejects(
        collectReleaseAssets(source, path.join(temporaryRoot, 'publish')),
        /exactly one Linux DEB/u,
      );
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });
});
