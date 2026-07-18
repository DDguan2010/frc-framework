import type { UpdateCheckResult } from '../shared/ipc.js';

export const GITHUB_REPOSITORY = 'DDguan2010/frc-framework';
export const GITHUB_REPOSITORY_URL = `https://github.com/${GITHUB_REPOSITORY}`;
const GITHUB_API_ROOT = `https://api.github.com/repos/${GITHUB_REPOSITORY}`;

export async function checkGitHubUpdates(
  currentVersion: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<UpdateCheckResult> {
  const request = (url: string) =>
    fetchImplementation(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `FRC-Framework/${currentVersion}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(10_000),
    });
  const response = await request(`${GITHUB_API_ROOT}/releases/latest`);
  if (response.status === 404) {
    const repository = await request(GITHUB_API_ROOT);
    if (repository.ok) {
      return {
        checkedAt: new Date().toISOString(),
        currentVersion,
        releasePublished: false,
        releaseUrl: `${GITHUB_REPOSITORY_URL}/releases`,
        updateAvailable: false,
      };
    }
  }
  if (!response.ok) {
    throw new Error(`GitHub Releases returned HTTP ${String(response.status)}.`);
  }
  const value = (await response.json()) as { html_url?: unknown; tag_name?: unknown };
  if (typeof value.tag_name !== 'string') throw new Error('GitHub release metadata is invalid.');
  const latestVersion = value.tag_name.replace(/^v/u, '');
  return {
    checkedAt: new Date().toISOString(),
    currentVersion,
    latestVersion,
    releasePublished: true,
    ...(typeof value.html_url === 'string' ? { releaseUrl: value.html_url } : {}),
    updateAvailable: compareVersions(latestVersion, currentVersion) > 0,
  };
}

export function compareVersions(left: string, right: string): number {
  const parse = (value: string): readonly number[] =>
    value
      .replace(/^v/u, '')
      .split(/[.+-]/u)
      .slice(0, 3)
      .map((entry) => Number(entry) || 0);
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}
