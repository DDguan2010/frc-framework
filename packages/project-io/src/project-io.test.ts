import { mkdtemp, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { createEmptyProject } from '@frc-framework/domain';
import { describe, expect, it } from 'vitest';

import {
  calculateFileDiff,
  createCandidateOutput,
  isSafeAutoApply,
  lineDiff,
} from './file-diff.js';
import { acquireProjectLock, detectStorageRisk } from './project-lock.js';
import { ProjectWatcher, resolveConflict } from './project-watcher.js';
import type { ProjectFileEvent } from './project-watcher.js';
import {
  applyFileTransaction,
  recoverIncompleteTransactions,
  SimulatedTransactionCrash,
} from './transaction.js';
import { migrateProjectYaml, parseProjectYaml, stringifyProjectYaml } from './yaml-project.js';
import { createThreeWayDiff } from './three-way-diff.js';

function model() {
  return createEmptyProject({
    id: '2e80f986-0bd5-4d82-b006-528f9cbd438f',
    javaPackage: 'frc.robot',
    name: 'Framework Test',
    teamNumber: 10541,
    wpilibYear: 2026,
  });
}

describe('project YAML', () => {
  it('keeps only the five newest schema migration backups', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-migration-retention-'));
    const projectPath = path.join(root, 'project.yaml');
    await writeFile(
      projectPath,
      stringifyProjectYaml(model()).replace('schemaVersion: 1', 'schemaVersion: 0'),
    );
    for (let index = 0; index < 7; index += 1) {
      await writeFile(
        `${projectPath}.backup-2000-01-0${String(index + 1)}T00-00-00-000Z`,
        'old backup',
      );
    }

    await migrateProjectYaml(projectPath);

    const backups = (await readdir(root)).filter((name) => name.startsWith('project.yaml.backup-'));
    expect(backups).toHaveLength(5);
  });

  it('round trips deterministically while preserving comments and unknown fields', () => {
    const original = `${stringifyProjectYaml(model())}\ncustomPlugin: # keep this comment\n  enabled: true\n`;
    const parsed = parseProjectYaml(original);
    expect(parsed.problems).toEqual([]);
    expect(parsed.unknownTopLevelKeys).toEqual(['customPlugin']);
    const output = stringifyProjectYaml(
      { ...parsed.model!, project: { ...parsed.model!.project, displayName: 'Renamed' } },
      parsed.document,
    );
    expect(output).toContain('customPlugin:');
    expect(output).toContain('# keep this comment');
    expect(output).toContain('displayName: Renamed');
    expect(
      stringifyProjectYaml(parseProjectYaml(output).model!, parseProjectYaml(output).document),
    ).toBe(output);
  });

  it('maps schema problems to paths and entity IDs', () => {
    const source = stringifyProjectYaml(model()).replace('teamNumber: 10541', 'teamNumber: nope');
    const parsed = parseProjectYaml(source);
    expect(parsed.model).toBeUndefined();
    expect(parsed.problems).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: '/project/teamNumber' })]),
    );
  });
});

describe('candidate diff and ownership', () => {
  it('detects add/modify/delete/rename and managed lines', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-diff-'));
    await writeFile(path.join(root, 'old.txt'), 'same\n', 'utf8');
    await writeFile(path.join(root, 'change.java'), '// <frc-framework:managed>\nold\n', 'utf8');
    const files = new Map<string, string | null>([
      ['old.txt', null],
      ['new.txt', 'same\n'],
      ['change.java', '// <frc-framework:managed>\nnew\n'],
    ]);
    const candidate = await createCandidateOutput(root, files);
    const diff = await calculateFileDiff(root, candidate);
    expect(diff.find((change) => change.path === 'new.txt')).toEqual(
      expect.objectContaining({ kind: 'renamed', previousPath: 'old.txt' }),
    );
    expect(diff.find((change) => change.path === 'change.java')?.lines).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'added', ownership: 'managed' })]),
    );
    expect(lineDiff('a\n', 'a\nb\n').some((line) => line.kind === 'added')).toBe(true);
    expect(isSafeAutoApply(diff)).toBe(false);
  });
});

describe('preset three-way upgrade', () => {
  it('applies generator-only changes and preserves user-only changes', () => {
    const base = new Map([
      ['generated.java', 'v1'],
      ['custom.java', 'base'],
    ]);
    const old = new Map([
      ['generated.java', 'v1'],
      ['custom.java', 'user edit'],
    ]);
    const next = new Map([
      ['generated.java', 'v2'],
      ['custom.java', 'base'],
      ['new.java', 'new file'],
    ]);
    const result = createThreeWayDiff(base, old, next);
    expect(result.safeToApply).toBe(true);
    expect(result.merged.get('generated.java')).toBe('v2');
    expect(result.merged.get('custom.java')).toBe('user edit');
    expect(result.merged.get('new.java')).toBe('new file');
  });

  it('blocks divergent changes to the same file without choosing a winner', () => {
    const result = createThreeWayDiff(
      new Map([['Swerve.java', 'base']]),
      new Map([['Swerve.java', 'user']]),
      new Map([['Swerve.java', 'preset v2']]),
    );
    expect(result.safeToApply).toBe(false);
    expect(result.conflicts).toEqual([
      expect.objectContaining({ path: 'Swerve.java', resolution: 'conflict' }),
    ]);
    expect(result.merged.has('Swerve.java')).toBe(false);
  });
});

describe('atomic transactions', () => {
  it('commits multiple files and rolls back a normal failure', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-transaction-'));
    await writeFile(path.join(root, 'project.yaml'), 'before\n', 'utf8');
    await expect(
      applyFileTransaction(
        root,
        new Map([
          ['project.yaml', 'after\n'],
          ['src/Robot.java', 'class Robot {}\n'],
        ]),
        { failAfter: 1 },
      ),
    ).rejects.toThrow('Injected transaction failure');
    expect(await readFile(path.join(root, 'project.yaml'), 'utf8')).toBe('before\n');
    await applyFileTransaction(
      root,
      new Map([
        ['project.yaml', 'after\n'],
        ['src/Robot.java', 'class Robot {}\n'],
      ]),
    );
    expect(await readFile(path.join(root, 'project.yaml'), 'utf8')).toBe('after\n');
    expect(await readFile(path.join(root, 'src/Robot.java'), 'utf8')).toContain('Robot');
  });

  it('recovers a transaction after a simulated process interruption', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-recover-'));
    await writeFile(path.join(root, 'one.txt'), 'one-before', 'utf8');
    await expect(
      applyFileTransaction(
        root,
        new Map([
          ['one.txt', 'one-after'],
          ['two.txt', 'two-after'],
        ]),
        { simulateCrashAfter: 1 },
      ),
    ).rejects.toBeInstanceOf(SimulatedTransactionCrash);
    expect(await readFile(path.join(root, 'one.txt'), 'utf8')).toBe('one-after');
    expect(await recoverIncompleteTransactions(root)).toHaveLength(1);
    expect(await readFile(path.join(root, 'one.txt'), 'utf8')).toBe('one-before');
  });
});

describe('watching and locking', () => {
  it('coalesces direct and safe-save changes and identifies self writes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-watch-'));
    await mkdir(path.join(root, 'src'), { recursive: true });
    const received: ProjectFileEvent[] = [];
    const watcher = new ProjectWatcher(root, {
      debounceMs: 30,
      hasPendingChanges: () => true,
      onEvents: (events) => received.push(...events),
    });
    await watcher.start();
    watcher.recordSelfWrite('project.yaml', 'self');
    await writeFile(path.join(root, 'project.yaml'), 'self', 'utf8');
    await writeFile(path.join(root, 'src', 'Robot.java.tmp'), 'external', 'utf8');
    await rename(path.join(root, 'src', 'Robot.java.tmp'), path.join(root, 'src', 'Robot.java'));
    await waitUntil(() => received.some((event) => event.path === 'src/Robot.java'));
    expect(received.find((event) => event.path === 'project.yaml')?.external).toBe(false);
    expect(received.find((event) => event.path === 'src/Robot.java')).toEqual(
      expect.objectContaining({ conflict: true, external: true }),
    );
    await watcher.close();
  });

  it('prevents two writers, supports read-only, and reports storage risk', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-lock-'));
    const first = await acquireProjectLock(root);
    const second = await acquireProjectLock(root);
    const readOnly = await acquireProjectLock(root, { readOnly: true });
    expect(first.mode).toBe('read-write');
    expect(second.mode).toBe('locked');
    expect(readOnly.mode).toBe('read-only');
    expect(detectStorageRisk('\\\\server\\robot')).toContain('network');
    expect(detectStorageRisk('C:\\Users\\Robot\\OneDrive\\Code')).toContain('synchronized');
    await first.release();
    const next = await acquireProjectLock(root);
    expect(next.mode).toBe('read-write');
    await next.release();
  });

  it('routes every explicit conflict action', async () => {
    const calls: string[] = [];
    const handlers = {
      compare: () => calls.push('compare'),
      keepExternal: () => calls.push('keep-external'),
      regenerate: () => calls.push('regenerate'),
      reload: () => calls.push('reload'),
    };
    for (const action of ['reload', 'compare', 'keep-external', 'regenerate'] as const) {
      await resolveConflict(action, handlers);
    }
    expect(calls).toEqual(['reload', 'compare', 'keep-external', 'regenerate']);
  });
});

async function waitUntil(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for watcher event.');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
