import { copyFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const virtualStore = path.join(repositoryRoot, 'node_modules', '.pnpm');
const candidates = [path.join(repositoryRoot, 'node_modules', 'electron-winstaller')];

for (const entry of await readdir(virtualStore, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name.startsWith('electron-winstaller@')) {
    candidates.push(path.join(virtualStore, entry.name, 'node_modules', 'electron-winstaller'));
  }
}

for (const packagePath of candidates) {
  const vendor = path.join(packagePath, 'vendor');
  await Promise.all([
    copyFile(path.join(vendor, `7z-${process.arch}.exe`), path.join(vendor, '7z.exe')),
    copyFile(path.join(vendor, `7z-${process.arch}.dll`), path.join(vendor, '7z.dll')),
  ]);
}

console.log(
  `Prepared electron-winstaller 7-Zip binaries in ${String(candidates.length)} package location(s).`,
);
