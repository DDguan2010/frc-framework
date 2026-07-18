import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseReleaseVersion } from './release-version.mjs';

const requested = parseReleaseVersion(process.argv.slice(2));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const relativePath of ['package.json', 'apps/desktop/package.json']) {
  const filePath = path.join(root, relativePath);
  const manifest = JSON.parse(await readFile(filePath, 'utf8'));
  manifest.version = requested;
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

console.log(`Prepared FRC Framework v${requested}.`);
