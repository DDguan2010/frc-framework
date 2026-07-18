import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { PathGrantRegistry } from './path-grants.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-path-grant-'));
  temporaryDirectories.push(directory);
  return directory;
}

describe('PathGrantRegistry', () => {
  it('allows the granted root and its descendants', async () => {
    const root = await temporaryDirectory();
    const child = path.join(root, 'src');
    const file = path.join(child, 'Robot.java');
    await mkdir(child);
    await writeFile(file, 'class Robot {}');

    const registry = new PathGrantRegistry();
    await registry.grant(root);

    await expect(registry.assertGranted(file)).resolves.toBe(await realPath(file));
  });

  it('rejects a path outside every granted root', async () => {
    const root = await temporaryDirectory();
    const outside = await temporaryDirectory();
    const registry = new PathGrantRegistry();
    await registry.grant(root);

    await expect(registry.assertGranted(outside)).rejects.toThrow('outside the authorized');
  });
});

async function realPath(value: string): Promise<string> {
  const { realpath } = await import('node:fs/promises');
  return realpath(value);
}
