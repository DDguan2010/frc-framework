import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SettingsStore } from './settings-store.js';

describe('SettingsStore', () => {
  it('persists settings, layout, and deduplicated recent projects atomically', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-settings-'));
    const filePath = path.join(directory, 'state.json');
    const store = new SettingsStore(filePath);
    await store.load();
    await store.updateSettings({ language: 'zh-CN', logLevel: 'debug' });
    await store.updateSettings({
      externalTools: {
        advantagescope: { mode: 'auto' },
        pathplanner: { executable: 'C:\\Tools\\PathPlanner.exe', mode: 'custom' },
      },
      projectEditors: { 'C:\\Robot': 'cursor' },
    });
    await store.updateSettings({
      projectUi: {
        'C:\\Robot': { expandedEntityIds: ['robot', 'shooter'], treeMode: 'logic' },
      },
    });
    await store.patchWindow({ inspectorWidth: 420, leftPanelWidth: 220 });
    await store.putRecent({
      available: true,
      displayName: 'First',
      lastOpenedAt: '2026-01-01T00:00:00.000Z',
      path: 'C:\\Robot',
    });
    await store.putRecent({
      available: true,
      displayName: 'Renamed',
      lastOpenedAt: '2026-01-02T00:00:00.000Z',
      path: 'c:\\robot',
    });
    expect(store.state.settings.language).toBe('zh-CN');
    expect(store.state.settings.projectUi['C:\\Robot']?.expandedEntityIds).toContain('shooter');
    expect(store.state.settings.projectEditors['C:\\Robot']).toBe('cursor');
    expect(store.state.settings.externalTools.pathplanner).toEqual({
      executable: 'C:\\Tools\\PathPlanner.exe',
      mode: 'custom',
    });
    expect(store.state.window.inspectorWidth).toBe(420);
    expect(store.state.recentProjects).toHaveLength(1);
    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual(
      expect.objectContaining({ settings: expect.objectContaining({ logLevel: 'debug' }) }),
    );

    const reopened = new SettingsStore(filePath);
    await reopened.load();
    expect(reopened.state.recentProjects[0]?.displayName).toBe('Renamed');
    expect(reopened.state.settings.projectUi['C:\\Robot']?.treeMode).toBe('logic');
  });

  it('recovers defaults and quarantines a corrupt settings file', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-settings-corrupt-'));
    const filePath = path.join(directory, 'state.json');
    await writeFile(filePath, '{broken', 'utf8');
    const store = new SettingsStore(filePath);
    await store.load();
    expect(store.state.settings.theme).toBe('dark');
    expect(store.state.recentProjects).toEqual([]);
  });
});
