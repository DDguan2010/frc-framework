import { hostname } from 'node:os';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

export interface ProjectLockInfo {
  readonly pid: number;
  readonly hostname: string;
  readonly createdAt: string;
  readonly projectRoot: string;
}

export interface ProjectLockResult {
  readonly mode: 'read-write' | 'read-only' | 'locked';
  readonly lock?: ProjectLockInfo;
  readonly release: () => Promise<void>;
}

export async function acquireProjectLock(
  projectRoot: string,
  options: { readonly readOnly?: boolean; readonly takeOwnership?: boolean } = {},
): Promise<ProjectLockResult> {
  const root = path.resolve(projectRoot);
  if (options.readOnly === true) {
    return { mode: 'read-only', release: async () => {} };
  }
  const lockPath = path.join(root, '.frc-framework', 'project.lock');
  await mkdir(path.dirname(lockPath), { recursive: true });
  if (options.takeOwnership === true) {
    await rm(lockPath, { force: true });
  }
  const info: ProjectLockInfo = {
    createdAt: new Date().toISOString(),
    hostname: hostname(),
    pid: process.pid,
    projectRoot: root,
  };
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(`${JSON.stringify(info, null, 2)}\n`, 'utf8');
    await handle.sync();
    await handle.close();
  } catch (error) {
    if (isNodeError(error) && error.code === 'EEXIST') {
      const existing = await readLock(lockPath);
      if (existing !== undefined && !isLockOwnerAlive(existing)) {
        await rm(lockPath, { force: true });
        return acquireProjectLock(root, options);
      }
      return {
        mode: 'locked',
        release: async () => {},
        ...(existing === undefined ? {} : { lock: existing }),
      };
    }
    throw error;
  }
  let released = false;
  return {
    lock: info,
    mode: 'read-write',
    release: async () => {
      if (!released) {
        released = true;
        const current = await readLock(lockPath);
        if (current?.pid === info.pid && current.createdAt === info.createdAt) {
          await rm(lockPath, { force: true });
        }
      }
    },
  };
}

export function detectStorageRisk(projectRoot: string): string | undefined {
  const normalized = projectRoot.replace(/\\/gu, '/');
  if (normalized.startsWith('//')) {
    return 'Project is on a network path; atomic rename guarantees may be weaker.';
  }
  if (/(?:^|\/)(?:OneDrive|Dropbox|Google Drive|iCloud Drive)(?:\/|$)/iu.test(normalized)) {
    return 'Project is inside a synchronized folder; concurrent sync may interfere with transactions.';
  }
  return undefined;
}

async function readLock(lockPath: string): Promise<ProjectLockInfo | undefined> {
  try {
    return JSON.parse(await readFile(lockPath, 'utf8')) as ProjectLockInfo;
  } catch {
    return undefined;
  }
}

function isLockOwnerAlive(info: ProjectLockInfo): boolean {
  if (info.hostname !== hostname()) {
    return true;
  }
  try {
    process.kill(info.pid, 0);
    return true;
  } catch {
    return false;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
