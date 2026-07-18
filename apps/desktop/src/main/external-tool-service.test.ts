import { describe, expect, it } from 'vitest';

import { externalToolCandidates, launchExternalTool } from './external-tool-service.js';

describe('external tool service', () => {
  it('provides deterministic automatic candidates for every supported application', () => {
    expect(externalToolCandidates('advantagescope').length).toBeGreaterThan(0);
    expect(externalToolCandidates('pathplanner').length).toBeGreaterThan(0);
  });

  it('uses only the configured custom executable and reports how to fix an invalid path', async () => {
    const executable = 'Z:\\missing\\PathPlanner.exe';
    await expect(
      launchExternalTool('pathplanner', process.cwd(), { executable, mode: 'custom' }),
    ).rejects.toThrow(`Check the custom path in Settings. Checked: ${executable}`);
  });
});
