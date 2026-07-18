import { randomUUID } from 'node:crypto';
import {
  copyFile,
  mkdir,
  open,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';

import { assertRelativePath } from './file-diff.js';

type TransactionState = 'prepared' | 'applying' | 'committed' | 'rolled-back';

interface TransactionEntry {
  readonly relativePath: string;
  readonly existed: boolean;
  readonly delete: boolean;
  readonly backupPath: string;
  readonly stagedPath?: string;
}

interface TransactionManifest {
  readonly id: string;
  readonly createdAt: string;
  readonly entries: readonly TransactionEntry[];
  state: TransactionState;
  appliedCount: number;
}

export interface ApplyTransactionOptions {
  readonly failAfter?: number;
  readonly simulateCrashAfter?: number;
}

export type ProjectFileContent = string | Uint8Array;

export interface AppliedTransaction {
  readonly id: string;
  readonly manifestPath: string;
  readonly changedFiles: readonly string[];
}

export async function applyFileTransaction(
  projectRoot: string,
  files: ReadonlyMap<string, ProjectFileContent | null>,
  options: ApplyTransactionOptions = {},
): Promise<AppliedTransaction> {
  const root = await canonicalDirectory(projectRoot);
  const id = randomUUID();
  const transactionRoot = path.join(root, '.frc-framework', 'transactions', id);
  const backupRoot = path.join(transactionRoot, 'backup');
  const stagedRoot = path.join(transactionRoot, 'staged');
  await mkdir(backupRoot, { recursive: true });
  await mkdir(stagedRoot, { recursive: true });

  const entries: TransactionEntry[] = [];
  for (const [relativePath, content] of files) {
    assertRelativePath(relativePath);
    const target = resolveInside(root, relativePath);
    await assertCanonicalTarget(root, target);
    const existed = await pathExists(target);
    const backupPath = path.join(backupRoot, relativePath);
    if (existed) {
      await mkdir(path.dirname(backupPath), { recursive: true });
      await copyFile(target, backupPath);
    }
    let stagedPath: string | undefined;
    if (content !== null) {
      stagedPath = path.join(stagedRoot, relativePath);
      await durableWrite(stagedPath, content);
    }
    entries.push({
      backupPath: path.relative(transactionRoot, backupPath),
      delete: content === null,
      existed,
      relativePath,
      ...(stagedPath === undefined
        ? {}
        : { stagedPath: path.relative(transactionRoot, stagedPath) }),
    });
  }
  const manifest: TransactionManifest = {
    appliedCount: 0,
    createdAt: new Date().toISOString(),
    entries,
    id,
    state: 'prepared',
  };
  const manifestPath = path.join(transactionRoot, 'manifest.json');
  await writeManifest(manifestPath, manifest);
  manifest.state = 'applying';
  await writeManifest(manifestPath, manifest);

  try {
    for (const [index, entry] of entries.entries()) {
      await applyEntry(root, transactionRoot, id, entry);
      manifest.appliedCount = index + 1;
      await writeManifest(manifestPath, manifest);
      if (options.simulateCrashAfter === manifest.appliedCount) {
        throw new SimulatedTransactionCrash(id);
      }
      if (options.failAfter === manifest.appliedCount) {
        throw new Error(
          `Injected transaction failure after ${String(manifest.appliedCount)} files.`,
        );
      }
    }
    manifest.state = 'committed';
    await writeManifest(manifestPath, manifest);
    return { changedFiles: entries.map((entry) => entry.relativePath), id, manifestPath };
  } catch (error) {
    if (error instanceof SimulatedTransactionCrash) {
      throw error;
    }
    await rollbackManifest(root, transactionRoot, manifest);
    manifest.state = 'rolled-back';
    await writeManifest(manifestPath, manifest);
    throw error;
  }
}

export async function recoverIncompleteTransactions(
  projectRoot: string,
): Promise<readonly string[]> {
  const root = await canonicalDirectory(projectRoot);
  const transactionsRoot = path.join(root, '.frc-framework', 'transactions');
  const recovered: string[] = [];
  let directories: readonly string[];
  try {
    directories = await readdir(transactionsRoot);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
  for (const directory of directories) {
    const transactionRoot = path.join(transactionsRoot, directory);
    const manifestPath = path.join(transactionRoot, 'manifest.json');
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as TransactionManifest;
      if (manifest.state === 'prepared' || manifest.state === 'applying') {
        await rollbackManifest(root, transactionRoot, manifest);
        manifest.state = 'rolled-back';
        await writeManifest(manifestPath, manifest);
        recovered.push(manifest.id);
      }
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return recovered;
}

export class SimulatedTransactionCrash extends Error {
  readonly transactionId: string;

  constructor(transactionId: string) {
    super(`Simulated process interruption in transaction ${transactionId}.`);
    this.name = 'SimulatedTransactionCrash';
    this.transactionId = transactionId;
  }
}

async function applyEntry(
  root: string,
  transactionRoot: string,
  id: string,
  entry: TransactionEntry,
): Promise<void> {
  const target = resolveInside(root, entry.relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  if (entry.delete) {
    await rm(target, { force: true });
    return;
  }
  if (entry.stagedPath === undefined) {
    throw new Error(`Missing staged file for ${entry.relativePath}.`);
  }
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.frc-${id}.tmp`);
  await copyFile(path.join(transactionRoot, entry.stagedPath), temporary);
  await syncFile(temporary);
  if (await pathExists(target)) {
    await unlink(target);
  }
  await rename(temporary, target);
}

async function rollbackManifest(
  root: string,
  transactionRoot: string,
  manifest: TransactionManifest,
): Promise<void> {
  for (
    let index = Math.min(manifest.appliedCount, manifest.entries.length) - 1;
    index >= 0;
    index -= 1
  ) {
    const entry = manifest.entries[index];
    if (entry === undefined) {
      continue;
    }
    const target = resolveInside(root, entry.relativePath);
    if (entry.existed) {
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(transactionRoot, entry.backupPath), target);
      await syncFile(target);
    } else {
      await rm(target, { force: true });
    }
  }
}

async function writeManifest(filePath: string, manifest: TransactionManifest): Promise<void> {
  const temporary = `${filePath}.tmp`;
  await durableWrite(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
  await rm(filePath, { force: true });
  await rename(temporary, filePath);
}

async function durableWrite(filePath: string, content: ProjectFileContent): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const handle = await open(filePath, 'w');
  try {
    if (typeof content === 'string') {
      await handle.writeFile(content, 'utf8');
    } else {
      await handle.writeFile(content);
    }
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncFile(filePath: string): Promise<void> {
  // Windows rejects FlushFileBuffers on a read-only file handle.
  const handle = await open(filePath, 'r+');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function resolveInside(root: string, relativePath: string): string {
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path escapes project root: ${relativePath}`);
  }
  return resolved;
}

async function canonicalDirectory(directory: string): Promise<string> {
  const info = await stat(directory);
  if (!info.isDirectory()) {
    throw new Error(`Project root is not a directory: ${directory}`);
  }
  return realpath(directory);
}

async function assertCanonicalTarget(root: string, target: string): Promise<void> {
  let cursor = target;
  while (!(await pathExists(cursor))) {
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      break;
    }
    cursor = parent;
  }
  const canonical = await realpath(cursor);
  const relative = path.relative(root, canonical);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Project path resolves outside the authorized root: ${target}`);
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
