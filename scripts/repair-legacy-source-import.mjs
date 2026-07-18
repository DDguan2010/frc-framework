import { createHash } from 'node:crypto';
import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { parseDocument } from 'yaml';

const projectRoot = process.argv[2];
if (projectRoot === undefined) {
  throw new Error('Usage: pnpm repair:source-import -- <project-folder>');
}

const yamlPath = path.resolve(projectRoot, 'project.yaml');
const document = parseDocument(await readFile(yamlPath, 'utf8'));
if (document.errors.length > 0) throw document.errors[0];
const model = document.toJS();
if (!Array.isArray(model?.commands)) throw new Error('project.yaml does not contain commands.');

const seen = new Set();
let repaired = 0;
for (const [index, command] of model.commands.entries()) {
  if (typeof command?.id !== 'string') continue;
  if (seen.has(command.id)) {
    const replacement = stableId(
      `legacy-source-import:${command.id}:${String(index)}:${String(command.javaFile)}:${String(command.displayName)}`,
    );
    document.setIn(['commands', index, 'id'], replacement);
    seen.add(replacement);
    repaired += 1;
  } else {
    seen.add(command.id);
  }
}

if (repaired === 0) {
  console.log('No duplicate legacy source-import command IDs were found.');
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[:.]/gu, '-');
const backupPath = `${yamlPath}.backup-legacy-import-${timestamp}`;
const temporaryPath = `${yamlPath}.repair.tmp`;
await copyFile(yamlPath, backupPath);
await writeFile(temporaryPath, document.toString({ lineWidth: 0 }), 'utf8');
await rename(temporaryPath, yamlPath);
console.log(`Repaired ${String(repaired)} duplicate command IDs. Backup: ${backupPath}`);

function stableId(value) {
  const bytes = createHash('sha1').update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
