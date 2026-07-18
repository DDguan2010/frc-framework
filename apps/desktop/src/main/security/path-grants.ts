import { realpath } from 'node:fs/promises';
import path from 'node:path';

export class PathGrantRegistry {
  readonly #roots = new Set<string>();

  async grant(rootPath: string): Promise<string> {
    const canonicalRoot = await realpath(rootPath);
    this.#roots.add(this.#normalize(canonicalRoot));
    return canonicalRoot;
  }

  async assertGranted(candidatePath: string): Promise<string> {
    const canonicalCandidate = await realpath(candidatePath);
    const normalizedCandidate = this.#normalize(canonicalCandidate);

    const allowed = [...this.#roots].some(
      (root) =>
        normalizedCandidate === root || normalizedCandidate.startsWith(`${root}${path.sep}`),
    );

    if (!allowed) {
      throw new Error('The requested path is outside the authorized project directory.');
    }

    return canonicalCandidate;
  }

  revokeAll(): void {
    this.#roots.clear();
  }

  #normalize(value: string): string {
    const normalized = path.normalize(value);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }
}
