import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseReleaseVersion } from './release-version.mjs';

describe('release version parser', () => {
  it('accepts direct pnpm arguments', () => {
    assert.equal(parseReleaseVersion(['1.0.0']), '1.0.0');
    assert.equal(parseReleaseVersion(['v1.2.3-beta.1']), '1.2.3-beta.1');
  });

  it('accepts pnpm argument forwarding with a literal separator', () => {
    assert.equal(parseReleaseVersion(['--', '1.0.0']), '1.0.0');
  });

  it('rejects missing, extra, or invalid values', () => {
    assert.throws(() => parseReleaseVersion([]), /Usage/u);
    assert.throws(() => parseReleaseVersion(['--']), /Usage/u);
    assert.throws(() => parseReleaseVersion(['1.0.0', '2.0.0']), /Usage/u);
    assert.throws(() => parseReleaseVersion(['latest']), /Usage/u);
  });
});
