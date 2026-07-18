import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type FileChangeKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'unchanged';
export type RegionOwnership = 'managed' | 'recognized' | 'custom';

export interface LineChange {
  readonly kind: 'context' | 'added' | 'removed';
  readonly text: string;
  readonly oldLine?: number;
  readonly newLine?: number;
  readonly ownership: RegionOwnership;
}

export interface FileChange {
  readonly path: string;
  readonly previousPath?: string;
  readonly kind: FileChangeKind;
  readonly before?: string;
  readonly after?: string;
  readonly lines: readonly LineChange[];
}

export interface CandidateOutput {
  readonly directory: string;
  readonly files: ReadonlyMap<string, string | null>;
}

export async function createCandidateOutput(
  projectRoot: string,
  files: ReadonlyMap<string, string | null>,
): Promise<CandidateOutput> {
  const directory = path.join(
    projectRoot,
    '.frc-framework',
    'candidates',
    `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  );
  for (const [relativePath, content] of files) {
    assertRelativePath(relativePath);
    if (content === null) {
      continue;
    }
    const candidatePath = path.join(directory, relativePath);
    await mkdir(path.dirname(candidatePath), { recursive: true });
    await writeFile(candidatePath, content, 'utf8');
  }
  return { directory, files: new Map(files) };
}

export async function calculateFileDiff(
  projectRoot: string,
  candidate: CandidateOutput,
): Promise<readonly FileChange[]> {
  const changes: FileChange[] = [];
  for (const [relativePath, after] of candidate.files) {
    assertRelativePath(relativePath);
    const before = await readOptional(path.join(projectRoot, relativePath));
    const kind: FileChangeKind =
      before === undefined
        ? after === null
          ? 'unchanged'
          : 'added'
        : after === null
          ? 'deleted'
          : before === after
            ? 'unchanged'
            : 'modified';
    changes.push({
      ...(after === null ? {} : { after }),
      ...(before === undefined ? {} : { before }),
      kind,
      lines: lineDiff(before ?? '', after ?? ''),
      path: relativePath,
    });
  }
  detectRenames(changes);
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

export function isSafeAutoApply(changes: readonly FileChange[]): boolean {
  return changes
    .filter((change) => change.kind !== 'unchanged')
    .every(
      (change) =>
        change.kind !== 'deleted' &&
        change.kind !== 'renamed' &&
        change.lines
          .filter((line) => line.kind !== 'context')
          .every((line) => line.ownership === 'managed'),
    );
}

export function lineDiff(before: string, after: string): readonly LineChange[] {
  const oldLines = before.split(/\r?\n/u);
  const newLines = after.split(/\r?\n/u);
  const table = Array.from(
    { length: oldLines.length + 1 },
    () => new Uint32Array(newLines.length + 1),
  );
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      table[oldIndex]![newIndex] =
        oldLines[oldIndex] === newLines[newIndex]
          ? table[oldIndex + 1]![newIndex + 1]! + 1
          : Math.max(table[oldIndex + 1]![newIndex]!, table[oldIndex]![newIndex + 1]!);
    }
  }
  const output: LineChange[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  let ownership: RegionOwnership = 'custom';
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    const oldLine = oldLines[oldIndex];
    const newLine = newLines[newIndex];
    if (oldLine === newLine && oldLine !== undefined) {
      ownership = ownershipAfterLine(ownership, oldLine);
      output.push({
        kind: 'context',
        newLine: newIndex + 1,
        oldLine: oldIndex + 1,
        ownership,
        text: oldLine,
      });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      newLine !== undefined &&
      (oldLine === undefined || table[oldIndex]![newIndex + 1]! >= table[oldIndex + 1]![newIndex]!)
    ) {
      ownership = ownershipAfterLine(ownership, newLine);
      output.push({ kind: 'added', newLine: newIndex + 1, ownership, text: newLine });
      newIndex += 1;
    } else if (oldLine !== undefined) {
      ownership = ownershipAfterLine(ownership, oldLine);
      output.push({ kind: 'removed', oldLine: oldIndex + 1, ownership, text: oldLine });
      oldIndex += 1;
    }
  }
  return output;
}

function ownershipAfterLine(current: RegionOwnership, line: string): RegionOwnership {
  if (line.includes('<frc-framework:managed>')) {
    return 'managed';
  }
  if (line.includes('<frc-framework:recognized>')) {
    return 'recognized';
  }
  if (line.includes('</frc-framework:managed>') || line.includes('</frc-framework:recognized>')) {
    return 'custom';
  }
  return current;
}

function detectRenames(changes: FileChange[]): void {
  const added = changes.filter((change) => change.kind === 'added');
  const deleted = changes.filter((change) => change.kind === 'deleted');
  for (const created of added) {
    const match = deleted.find(
      (removed) =>
        removed.kind === 'deleted' &&
        created.after !== undefined &&
        removed.before !== undefined &&
        digest(created.after) === digest(removed.before),
    );
    if (match !== undefined) {
      Object.assign(created, { kind: 'renamed', previousPath: match.path });
      Object.assign(match, { kind: 'unchanged' });
    }
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function readOptional(filePath: string): Promise<string | undefined> {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

export function assertRelativePath(relativePath: string): void {
  if (
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]/u).some((segment) => segment === '..' || segment.length === 0)
  ) {
    throw new Error(`Unsafe project-relative path: ${relativePath}`);
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
