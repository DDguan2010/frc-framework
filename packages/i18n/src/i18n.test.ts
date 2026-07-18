import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { I18n, resolveLocale } from './i18n.js';
import { en, zhCN } from './translations.js';

describe('i18n', () => {
  it('keeps English and Chinese translation keys identical', () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
    expect(Object.values(en).every((value) => value.trim().length > 0)).toBe(true);
    expect(Object.values(zhCN).every((value) => value.trim().length > 0)).toBe(true);
  });

  it('follows the system language and switches immediately', () => {
    expect(resolveLocale('zh-Hans-CN')).toBe('zh-CN');
    expect(resolveLocale('en-US')).toBe('en');
    const i18n = new I18n('en');
    expect(i18n.t('home.create')).toBe('Create project');
    i18n.setLocale('zh-CN');
    expect(i18n.t('home.create')).toBe('创建项目');
  });

  it('formats locale-aware dates, values, units, and plurals', () => {
    const i18n = new I18n('en');
    expect(i18n.formatNumber(1234.5)).toContain('1,234');
    expect(i18n.formatUnit(12, 'meter-per-second')).toContain('12');
    expect(i18n.plural(2, { one: 'item', other: 'items' })).toBe('items');
    expect(i18n.formatDate(new Date('2026-01-02T00:00:00Z'), { timeZone: 'UTC' })).toContain(
      '2026',
    );
  });

  it('prevents hard-coded accessible labels in the renderer shell', () => {
    const renderer = readFileSync(
      fileURLToPath(new URL('../../../apps/desktop/src/renderer/ui/app-shell.ts', import.meta.url)),
      'utf8',
    );
    expect(
      renderer.match(/(?:aria-label|label|placeholder|title)="[A-Za-z\u4e00-\u9fff][^"]*"/gu),
    ).toBeNull();
  });
});
