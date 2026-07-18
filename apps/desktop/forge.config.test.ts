import { describe, expect, it } from 'vitest';

import config from './forge.config.js';

interface ConfiguredMaker {
  readonly name: string;
  readonly config: {
    readonly options?: {
      readonly bin?: string;
      readonly name?: string;
      readonly productName?: string;
    };
  };
  prepareConfig(architecture: 'x64'): Promise<void>;
}

describe('Electron Forge configuration', () => {
  it('keeps Linux package metadata aligned with the packaged executable', async () => {
    expect(config.packagerConfig?.executableName).toBe('frc-framework');
    const makers = (config.makers ?? []).filter(
      (maker): maker is ConfiguredMaker =>
        typeof maker === 'object' &&
        maker !== null &&
        'name' in maker &&
        (maker.name === 'deb' || maker.name === 'rpm'),
    );
    expect(makers).toHaveLength(2);
    for (const maker of makers) {
      await maker.prepareConfig('x64');
      expect(maker.config.options).toEqual({
        bin: 'frc-framework',
        name: 'frc-framework',
        productName: 'FRC Framework',
      });
    }
  });
});
