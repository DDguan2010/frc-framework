import { describe, expect, it, vi } from 'vitest';

import { checkGitHubUpdates, compareVersions, GITHUB_REPOSITORY } from './update-service.js';

describe('GitHub update service', () => {
  it('uses the published repository and distinguishes an empty Releases page from an error', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const result = await checkGitHubUpdates('0.1.0', fetchImplementation);
    expect(GITHUB_REPOSITORY).toBe('DDguan2010/frc-framework');
    expect(fetchImplementation.mock.calls[0]?.[0]).toBe(
      'https://api.github.com/repos/DDguan2010/frc-framework/releases/latest',
    );
    expect(result).toMatchObject({ releasePublished: false, updateAvailable: false });
  });

  it('reports a newer published semantic version', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        html_url: 'https://github.com/DDguan2010/frc-framework/releases/tag/v0.2.0',
        tag_name: 'v0.2.0',
      }),
    );
    const result = await checkGitHubUpdates('0.1.0', fetchImplementation);
    expect(result).toMatchObject({
      latestVersion: '0.2.0',
      releasePublished: true,
      updateAvailable: true,
    });
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0);
  });
});
