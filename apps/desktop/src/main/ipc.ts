import { writeFile } from 'node:fs/promises';

import { app, dialog, ipcMain } from 'electron';

import {
  SCHEMA_VERSION,
  SUPPORTED_WPILIB_YEARS,
  type AppInfo,
  type DomainCommand,
  type Platform,
} from '@frc-framework/domain';
import { PRESET_API_VERSION, PRESET_MANIFESTS } from '@frc-framework/presets';

import { IPC_CHANNELS } from '../shared/ipc.js';
import type {
  AppSettings,
  AddImportRequest,
  CreateProjectRequest,
  DirectorySelection,
  EditorConfiguration,
  EditorOpenRequest,
  ExternalTool,
  ProjectOpenResult,
  ProjectChangePreview,
  RecentProject,
  WindowState,
  NtConnectRequest,
  NtSnapshotView,
  ToolchainInfoView,
  ToolchainSnapshotView,
  ToolchainTask,
  DocSupplementRequest,
  CalibrationTestRequest,
  ExternalConflictRequest,
  ExternalConflictResult,
  UpdateCheckResult,
} from '../shared/ipc.js';
import { detectEditors, openEditor, validateEditor } from './editor-service.js';
import { launchExternalTool } from './external-tool-service.js';
import type { ProjectService } from './project-service.js';
import type { SettingsStore } from './settings-store.js';
import type { NtService } from './nt-service.js';
import type { ToolchainService } from './toolchain-service.js';
import { checkGitHubUpdates } from './update-service.js';

export function registerIpcHandlers(
  settings: SettingsStore,
  projects: ProjectService,
  nt: NtService,
  toolchain: ToolchainService,
): void {
  ipcMain.handle(IPC_CHANNELS.appGetInfo, (): AppInfo => ({
    name: app.getName(),
    platform: process.platform as Platform,
    release: {
      baseVersion: 1,
      presetApiVersion: PRESET_API_VERSION,
      presets: PRESET_MANIFESTS.map(({ id, version }) => ({ id, version })),
      schemaVersion: SCHEMA_VERSION,
      supportedWpilibYears: SUPPORTED_WPILIB_YEARS,
    },
    version: app.getVersion(),
  }));
  ipcMain.handle(IPC_CHANNELS.appCheckUpdates, async (): Promise<UpdateCheckResult> => {
    return checkGitHubUpdates(app.getVersion());
  });

  ipcMain.handle(IPC_CHANNELS.settingsGet, (): AppSettings => settings.state.settings);
  ipcMain.handle(
    IPC_CHANNELS.settingsUpdate,
    async (_event, changes: Partial<AppSettings>): Promise<AppSettings> => {
      if (changes.editor !== undefined) {
        await validateEditor(changes.editor);
      }
      return settings.updateSettings(changes);
    },
  );
  ipcMain.handle(IPC_CHANNELS.externalLaunch, (_event, tool: ExternalTool): Promise<void> => {
    if (tool !== 'advantagescope' && tool !== 'pathplanner') {
      throw new Error('Unknown external FRC tool.');
    }
    return launchExternalTool(
      tool,
      projects.toolchainContext().projectRoot,
      settings.state.settings.externalTools[tool],
    );
  });
  ipcMain.handle(
    IPC_CHANNELS.externalChoose,
    async (_event, tool: ExternalTool): Promise<string | undefined> => {
      if (tool !== 'advantagescope' && tool !== 'pathplanner') {
        throw new Error('Unknown external FRC tool.');
      }
      const result = await dialog.showOpenDialog({
        filters:
          process.platform === 'win32'
            ? [{ extensions: ['exe'], name: 'Applications' }]
            : [{ extensions: ['*'], name: 'Applications' }],
        properties: process.platform === 'darwin' ? ['openFile', 'openDirectory'] : ['openFile'],
        title: `Choose ${tool === 'advantagescope' ? 'AdvantageScope' : 'PathPlanner'}`,
      });
      return result.canceled ? undefined : result.filePaths[0];
    },
  );
  ipcMain.handle(
    IPC_CHANNELS.diagnosticsExport,
    async (_event, markdown: string): Promise<string | undefined> => {
      if (typeof markdown !== 'string' || markdown.length > 2_000_000) {
        throw new Error('Diagnostic report is invalid or too large.');
      }
      const result = await dialog.showSaveDialog({
        defaultPath: 'frc-framework-diagnostics.md',
        filters: [{ extensions: ['md'], name: 'Markdown' }],
        title: 'Export diagnostic report',
      });
      if (result.canceled || result.filePath === undefined) return undefined;
      await writeFile(result.filePath, markdown, 'utf8');
      return result.filePath;
    },
  );
  ipcMain.handle(IPC_CHANNELS.windowGetState, (): WindowState => settings.state.window);
  ipcMain.handle(
    IPC_CHANNELS.windowUpdateState,
    (_event, changes: Partial<WindowState>): Promise<WindowState> => settings.patchWindow(changes),
  );

  ipcMain.handle(IPC_CHANNELS.editorDetect, detectEditors);
  ipcMain.handle(
    IPC_CHANNELS.editorOpen,
    (_event, configuration: EditorConfiguration, request: EditorOpenRequest) =>
      openEditor(configuration, request),
  );

  ipcMain.handle(IPC_CHANNELS.projectChooseDirectory, async (): Promise<DirectorySelection> => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: 'Choose an FRC project folder',
    });
    const selectedPath = result.filePaths[0];
    return result.canceled || selectedPath === undefined
      ? { canceled: true }
      : projects.inspectDirectory(selectedPath);
  });
  ipcMain.handle(
    IPC_CHANNELS.projectOpenPath,
    (_event, projectPath: string): Promise<ProjectOpenResult> => projects.open(projectPath),
  );
  ipcMain.handle(IPC_CHANNELS.projectRefresh, (): Promise<ProjectOpenResult> => projects.refresh());
  ipcMain.handle(
    IPC_CHANNELS.projectResolveExternal,
    (_event, request: ExternalConflictRequest): Promise<ExternalConflictResult> =>
      projects.resolveExternal(request),
  );
  ipcMain.handle(IPC_CHANNELS.projectMigrate, (): Promise<ProjectOpenResult> => projects.migrate());
  ipcMain.handle(
    IPC_CHANNELS.projectCreate,
    (_event, request: CreateProjectRequest): Promise<ProjectOpenResult> => projects.create(request),
  );
  ipcMain.handle(
    IPC_CHANNELS.projectPreviewCommand,
    (_event, command: DomainCommand): Promise<ProjectChangePreview> =>
      projects.previewCommand(command),
  );
  ipcMain.handle(
    IPC_CHANNELS.projectAddImport,
    (_event, request: AddImportRequest): Promise<ProjectChangePreview> =>
      projects.addImport(request),
  );
  ipcMain.handle(
    IPC_CHANNELS.projectApplyPreview,
    (_event, previewId: string): Promise<ProjectOpenResult> => projects.applyPreview(previewId),
  );
  ipcMain.handle(IPC_CHANNELS.projectConfirmSourceImport, (): Promise<ProjectChangePreview> =>
    projects.confirmSourceImport(),
  );
  ipcMain.handle(
    IPC_CHANNELS.projectReadDocSupplement,
    (_event, filePath: string): Promise<string> => projects.readDocSupplement(filePath),
  );
  ipcMain.handle(
    IPC_CHANNELS.projectPreviewDocSupplement,
    (_event, request: DocSupplementRequest): Promise<ProjectChangePreview> =>
      projects.previewDocSupplement(request),
  );
  ipcMain.handle(IPC_CHANNELS.projectDiscardPreview, (_event, previewId: string): Promise<void> =>
    projects.discardPreview(previewId),
  );

  ipcMain.handle(IPC_CHANNELS.ntConnect, (_event, request: NtConnectRequest): NtSnapshotView =>
    nt.connect(request),
  );
  ipcMain.handle(IPC_CHANNELS.ntDisconnect, (): NtSnapshotView => nt.disconnect());
  ipcMain.handle(IPC_CHANNELS.ntSnapshot, (): NtSnapshotView => nt.snapshot());
  ipcMain.handle(
    IPC_CHANNELS.ntCalibrationStart,
    (_event, request: CalibrationTestRequest): NtSnapshotView => nt.startCalibrationTest(request),
  );
  ipcMain.handle(IPC_CHANNELS.ntCalibrationStop, (): NtSnapshotView => nt.stopCalibrationTest());
  ipcMain.handle(IPC_CHANNELS.toolchainInfo, (): Promise<ToolchainInfoView> => toolchain.info());
  ipcMain.handle(
    IPC_CHANNELS.toolchainStart,
    (_event, task: ToolchainTask, confirmed: boolean): ToolchainSnapshotView =>
      toolchain.start(task, confirmed),
  );
  ipcMain.handle(IPC_CHANNELS.toolchainCancel, (): ToolchainSnapshotView => toolchain.cancel());
  ipcMain.handle(IPC_CHANNELS.toolchainSnapshot, (): ToolchainSnapshotView => toolchain.snapshot());

  ipcMain.handle(IPC_CHANNELS.recentList, (): Promise<readonly RecentProject[]> =>
    projects.recent(),
  );
  ipcMain.handle(
    IPC_CHANNELS.recentRemove,
    (_event, projectPath: string): Promise<readonly RecentProject[]> =>
      projects.removeRecent(projectPath),
  );
  ipcMain.handle(
    IPC_CHANNELS.recentRelink,
    async (_event, oldPath: string): Promise<readonly RecentProject[]> => {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
      const selectedPath = result.filePaths[0];
      return result.canceled || selectedPath === undefined
        ? projects.recent()
        : projects.relinkRecent(oldPath, selectedPath);
    },
  );
}

export function unregisterIpcHandlers(): void {
  for (const channel of Object.values(IPC_CHANNELS)) {
    if (channel !== IPC_CHANNELS.projectOpened && channel !== IPC_CHANNELS.projectFilesChanged) {
      ipcMain.removeHandler(channel);
    }
  }
}
