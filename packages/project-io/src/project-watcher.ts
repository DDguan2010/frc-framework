import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import chokidar, { type FSWatcher } from 'chokidar';

export type ProjectFileEventKind = 'add' | 'change' | 'unlink';

export interface ProjectFileEvent {
  readonly kind: ProjectFileEventKind;
  readonly path: string;
  readonly external: boolean;
  readonly conflict: boolean;
}

export interface ProjectWatcherOptions {
  readonly debounceMs?: number;
  readonly hasPendingChanges?: () => boolean;
  readonly onEvents: (events: readonly ProjectFileEvent[]) => void;
}

export class ProjectWatcher {
  readonly #root: string;
  readonly #options: Required<Pick<ProjectWatcherOptions, 'debounceMs'>> & ProjectWatcherOptions;
  readonly #selfWrites = new Map<string, string | null>();
  readonly #pending = new Map<string, ProjectFileEventKind>();
  #watcher: FSWatcher | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(root: string, options: ProjectWatcherOptions) {
    this.#root = path.resolve(root);
    this.#options = { ...options, debounceMs: options.debounceMs ?? 80 };
  }

  async start(): Promise<void> {
    if (this.#watcher !== undefined) {
      return;
    }
    this.#watcher = chokidar.watch('.', {
      awaitWriteFinish: { pollInterval: 25, stabilityThreshold: 75 },
      cwd: this.#root,
      ignored: (watchedPath) =>
        /(?:^|[\\/])(?:\.frc-framework|build|\.gradle|node_modules)(?:[\\/]|$)/u.test(watchedPath),
      ignoreInitial: true,
    });
    this.#watcher.on('add', (file) => this.#queue('add', file));
    this.#watcher.on('change', (file) => this.#queue('change', file));
    this.#watcher.on('unlink', (file) => this.#queue('unlink', file));
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, 2_000);
      this.#watcher?.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.#watcher?.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  recordSelfWrite(relativePath: string, content: string | null): void {
    this.#selfWrites.set(normalize(relativePath), content === null ? null : digest(content));
  }

  async close(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    await this.#watcher?.close();
    this.#watcher = undefined;
  }

  #queue(kind: ProjectFileEventKind, relativePath: string): void {
    if (!isProjectFile(relativePath)) {
      return;
    }
    this.#pending.set(normalize(relativePath), kind);
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(() => void this.#flush(), this.#options.debounceMs);
  }

  async #flush(): Promise<void> {
    this.#timer = undefined;
    const entries = [...this.#pending.entries()];
    this.#pending.clear();
    const events: ProjectFileEvent[] = [];
    for (const [relativePath, kind] of entries) {
      const expected = this.#selfWrites.get(relativePath);
      let actual: string | null;
      try {
        actual = digest(await readFile(path.join(this.#root, relativePath), 'utf8'));
      } catch {
        actual = null;
      }
      const external = expected === undefined || expected !== actual;
      if (!external) {
        this.#selfWrites.delete(relativePath);
      }
      // Atomic replacement is implemented as unlink + rename. Some platforms
      // coalesce that pair to a stale unlink event even though the final file
      // already exists, so report the state observed after debounce instead.
      const observedKind = actual === null ? 'unlink' : kind === 'unlink' ? 'change' : kind;
      events.push({
        conflict: external && (this.#options.hasPendingChanges?.() ?? false),
        external,
        kind: observedKind,
        path: relativePath,
      });
    }
    if (events.length > 0) {
      this.#options.onEvents(events);
    }
  }
}

export const CONFLICT_ACTIONS = ['reload', 'compare', 'keep-external', 'regenerate'] as const;
export type ConflictAction = (typeof CONFLICT_ACTIONS)[number];

export interface ConflictHandlers<T> {
  readonly compare: () => Promise<T> | T;
  readonly keepExternal: () => Promise<T> | T;
  readonly regenerate: () => Promise<T> | T;
  readonly reload: () => Promise<T> | T;
}

export function resolveConflict<T>(
  action: ConflictAction,
  handlers: ConflictHandlers<T>,
): Promise<T> | T {
  switch (action) {
    case 'reload':
      return handlers.reload();
    case 'compare':
      return handlers.compare();
    case 'keep-external':
      return handlers.keepExternal();
    case 'regenerate':
      return handlers.regenerate();
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalize(relativePath: string): string {
  return relativePath.replace(/\\/gu, '/');
}

function isProjectFile(relativePath: string): boolean {
  const normalized = normalize(relativePath);
  return (
    normalized === 'project.yaml' ||
    /^(?:build|settings)\.gradle(?:\.kts)?$/u.test(normalized) ||
    normalized === 'gradle.properties' ||
    /^src\/.*\.java$/u.test(normalized) ||
    /^vendordeps\/.*\.json$/u.test(normalized) ||
    /^docs\/.*\.(?:md|markdown)$/u.test(normalized)
  );
}
