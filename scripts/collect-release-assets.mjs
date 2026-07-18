import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const expectedInstallers = new Map([
  ['.deb', 'Linux DEB'],
  ['.dmg', 'macOS DMG'],
  ['.exe', 'Windows Setup'],
  ['.rpm', 'Linux RPM'],
]);

export async function collectReleaseAssets(sourceRoot, destinationRoot) {
  const files = await filesBelow(path.resolve(sourceRoot));
  const installers = files.filter(isPublicInstaller);

  for (const [extension, label] of expectedInstallers) {
    const matches = installers.filter((file) => path.extname(file).toLowerCase() === extension);
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one ${label} installer, but found ${String(matches.length)}.`,
      );
    }
  }

  const duplicateNames = duplicateBasenames(installers);
  if (duplicateNames.length > 0) {
    throw new Error(`Release installer names must be unique: ${duplicateNames.join(', ')}`);
  }

  const destination = path.resolve(destinationRoot);
  await mkdir(destination, { recursive: true });
  for (const installer of installers) {
    await copyFile(installer, path.join(destination, path.basename(installer)));
  }

  const names = installers.map((file) => path.basename(file)).sort();
  process.stdout.write(
    `Collected ${String(names.length)} public installers:\n${names.join('\n')}\n`,
  );
  return names;
}

function isPublicInstaller(file) {
  const extension = path.extname(file).toLowerCase();
  if (!expectedInstallers.has(extension)) return false;
  return extension !== '.exe' || path.basename(file).toLowerCase().endsWith('setup.exe');
}

function duplicateBasenames(files) {
  const counts = new Map();
  for (const file of files) {
    const basename = path.basename(file);
    counts.set(basename, (counts.get(basename) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([basename]) => basename)
    .sort();
}

async function filesBelow(root) {
  const output = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...(await filesBelow(target)));
    else if (entry.isFile()) output.push(target);
  }
  return output.sort();
}

const invokedPath = process.argv[1];
if (invokedPath !== undefined && path.resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const [sourceRoot, destinationRoot] = process.argv.slice(2);
  if (sourceRoot === undefined || destinationRoot === undefined) {
    throw new Error('Usage: node scripts/collect-release-assets.mjs <source> <destination>');
  }
  await collectReleaseAssets(sourceRoot, destinationRoot);
}
