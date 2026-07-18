import { describe, expect, it } from 'vitest';

import { isAbortedNavigation, isRendererReload } from './renderer-navigation.js';

describe('renderer navigation policy', () => {
  it('allows Vite to reload its current development origin', () => {
    expect(isRendererReload('http://localhost:5173/', 'http://localhost:5173/')).toBe(true);
    expect(isRendererReload('http://localhost:5173/#home', 'http://localhost:5173/#project')).toBe(
      true,
    );
  });

  it('continues to block external and malformed navigation', () => {
    expect(isRendererReload('http://localhost:5173/', 'https://example.com/')).toBe(false);
    expect(isRendererReload('http://localhost:5173/', 'http://localhost:5173/main.ts')).toBe(false);
    expect(isRendererReload('file:///app/index.html', 'file:///app/other.html')).toBe(false);
    expect(isRendererReload('', 'http://localhost:5173/')).toBe(false);
    expect(isRendererReload('not a URL', 'also not a URL')).toBe(false);
  });

  it('allows only an exact packaged-file reload', () => {
    expect(isRendererReload('file:///app/index.html', 'file:///app/index.html')).toBe(true);
  });

  it('recognizes Electron loadURL aborts caused by a replacement reload', () => {
    const aborted = Object.assign(new Error('navigation replaced'), { code: 'ERR_ABORTED' });
    expect(isAbortedNavigation(aborted)).toBe(true);
    expect(isAbortedNavigation(new Error('ERR_ABORTED (-3) loading page'))).toBe(true);
    expect(isAbortedNavigation(new Error('ERR_FAILED'))).toBe(false);
  });
});
