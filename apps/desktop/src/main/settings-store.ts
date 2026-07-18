import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { AppSettings, RecentProject, WindowState } from '../shared/ipc.js';

export interface PersistedState {
  readonly settingsVersion: number;
  readonly settings: AppSettings;
  readonly recentProjects: readonly RecentProject[];
  readonly window: WindowState;
}

const SETTINGS_VERSION = 2;

export const DEFAULT_SETTINGS: AppSettings = {
  autoApplySafeChanges: false,
  defaultProject: { javaPackage: 'frc.robot', teamNumber: 0, wpilibYear: 2026 },
  density: 'comfortable',
  externalTools: {
    advantagescope: { mode: 'auto' },
    pathplanner: { mode: 'auto' },
  },
  language: 'system',
  logLevel: 'info',
  previewChanges: false,
  projectEditors: {},
  projectUi: {},
  theme: 'dark',
};

const DEFAULT_WINDOW: WindowState = {
  bottomPanelHeight: 180,
  height: 800,
  inspectorWidth: 300,
  leftPanelWidth: 176,
  maximized: false,
  width: 1360,
};

export class SettingsStore {
  readonly #filePath: string;
  #state: PersistedState = {
    recentProjects: [],
    settingsVersion: SETTINGS_VERSION,
    settings: DEFAULT_SETTINGS,
    window: DEFAULT_WINDOW,
  };

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  get state(): PersistedState {
    return structuredClone(this.#state);
  }

  async load(): Promise<PersistedState> {
    try {
      const source = JSON.parse(await readFile(this.#filePath, 'utf8')) as Partial<PersistedState>;
      const needsDefaultMigration = source.settingsVersion !== SETTINGS_VERSION;
      this.#state = {
        recentProjects: Array.isArray(source.recentProjects)
          ? source.recentProjects.slice(0, 20)
          : [],
        settingsVersion: SETTINGS_VERSION,
        settings: mergeSettings({
          ...source.settings,
          ...(needsDefaultMigration ? { previewChanges: false } : {}),
        }),
        window: { ...DEFAULT_WINDOW, ...source.window },
      };
      if (needsDefaultMigration) await this.#save();
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        const corruptPath = `${this.#filePath}.corrupt-${Date.now()}`;
        await mkdir(path.dirname(corruptPath), { recursive: true });
        await rename(this.#filePath, corruptPath).catch(() => {});
      }
    }
    return this.state;
  }

  async updateSettings(changes: Partial<AppSettings>): Promise<AppSettings> {
    this.#state = {
      ...this.#state,
      settings: mergeSettings({ ...this.#state.settings, ...changes }),
    };
    await this.#save();
    return this.state.settings;
  }

  async updateWindow(window: WindowState): Promise<void> {
    this.#state = { ...this.#state, window: { ...DEFAULT_WINDOW, ...window } };
    await this.#save();
  }

  async patchWindow(changes: Partial<WindowState>): Promise<WindowState> {
    this.#state = { ...this.#state, window: { ...this.#state.window, ...changes } };
    await this.#save();
    return this.state.window;
  }

  async putRecent(project: RecentProject): Promise<readonly RecentProject[]> {
    const recentProjects = [
      project,
      ...this.#state.recentProjects.filter(
        (candidate) => candidate.path.toLowerCase() !== project.path.toLowerCase(),
      ),
    ].slice(0, 20);
    this.#state = { ...this.#state, recentProjects };
    await this.#save();
    return this.state.recentProjects;
  }

  async removeRecent(projectPath: string): Promise<readonly RecentProject[]> {
    this.#state = {
      ...this.#state,
      recentProjects: this.#state.recentProjects.filter(
        (candidate) => candidate.path.toLowerCase() !== projectPath.toLowerCase(),
      ),
    };
    await this.#save();
    return this.state.recentProjects;
  }

  async replaceRecentPath(
    oldPath: string,
    project: RecentProject,
  ): Promise<readonly RecentProject[]> {
    await this.removeRecent(oldPath);
    return this.putRecent(project);
  }

  async #save(): Promise<void> {
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    const temporary = `${this.#filePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.#state, null, 2)}\n`, 'utf8');
    await rename(temporary, this.#filePath);
  }
}

function mergeSettings(value: Partial<AppSettings> | undefined): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    defaultProject: { ...DEFAULT_SETTINGS.defaultProject, ...value?.defaultProject },
    externalTools: {
      advantagescope: {
        ...DEFAULT_SETTINGS.externalTools.advantagescope,
        ...value?.externalTools?.advantagescope,
      },
      pathplanner: {
        ...DEFAULT_SETTINGS.externalTools.pathplanner,
        ...value?.externalTools?.pathplanner,
      },
    },
    projectEditors: value?.projectEditors ?? {},
    projectUi: value?.projectUi ?? {},
    ...(value?.editor === undefined ? {} : { editor: value.editor }),
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
