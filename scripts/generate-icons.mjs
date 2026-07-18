import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { IconIcns, IconIco } from '@shockpkg/icon-encoder';
import sharp from 'sharp';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const iconDirectory = path.join(repositoryRoot, 'resources', 'icons');
const sourcePath = path.join(iconDirectory, 'frameworklogo.svg');
const source = Buffer.from(
  (await readFile(sourcePath, 'utf8')).replaceAll('<path ', '<path fill="none" '),
);
const sizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const pngs = new Map();

await mkdir(iconDirectory, { recursive: true });

for (const size of sizes) {
  const png = await sharp(source)
    .resize(size, size, {
      background: { alpha: 0, b: 0, g: 0, r: 0 },
      fit: 'contain',
    })
    .png()
    .toBuffer();
  pngs.set(size, png);
}

const ico = new IconIco();
for (const size of [256, 128, 64, 48, 32, 16]) {
  await ico.addFromPng(requiredPng(size), null, true);
}

const icns = new IconIcns();
icns.toc = true;
await icns.addFromPng(requiredPng(16), ['ic04'], true);
await icns.addFromPng(requiredPng(32), ['ic05', 'ic11'], true);
await icns.addFromPng(requiredPng(64), ['ic12'], true);
await icns.addFromPng(requiredPng(128), ['ic07'], true);
await icns.addFromPng(requiredPng(256), ['ic08', 'ic13'], true);
await icns.addFromPng(requiredPng(512), ['ic09', 'ic14'], true);
await icns.addFromPng(requiredPng(1024), ['ic10'], true);

await Promise.all([
  writeFile(path.join(iconDirectory, 'icon.png'), requiredPng(1024)),
  writeFile(path.join(iconDirectory, 'icon.ico'), ico.encode()),
  writeFile(path.join(iconDirectory, 'icon.icns'), icns.encode()),
]);

console.log(
  `Generated icon.png, icon.ico, and icon.icns from ${path.relative(repositoryRoot, sourcePath)}.`,
);

function requiredPng(size) {
  const png = pngs.get(size);
  if (png === undefined) throw new Error(`Missing generated ${size}x${size} PNG.`);
  return png;
}
