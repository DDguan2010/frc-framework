import { contextBridge, ipcRenderer, webUtils } from 'electron';

import type { AppInfo, DomainCommand } from '@frc-framework/domain';

import { IPC_CHANNELS } from '../shared/ipc.js';
import type {
  AppSettings,
  AddImportRequest,
  CreateProjectRequest,
  DirectorySelection,
  EditorConfiguration,
  EditorOpenRequest,
  ExternalTool,
  FrameworkApi,
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
  UpdateCheckResult,
  ExternalConflictRequest,
  ExternalConflictResult,
  ProjectFileEventView,
} from '../shared/ipc.js';

const frameworkApi: FrameworkApi = Object.freeze({
  app: Object.freeze({
    getInfo: (): Promise<AppInfo> => ipcRenderer.invoke(IPC_CHANNELS.appGetInfo),
    checkUpdates: (): Promise<UpdateCheckResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.appCheckUpdates),
  }),
  editor: Object.freeze({
    detect: () => ipcRenderer.invoke(IPC_CHANNELS.editorDetect),
    open: (configuration: EditorConfiguration, request: EditorOpenRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.editorOpen, configuration, request),
  }),
  external: Object.freeze({
    choose: (tool: ExternalTool): Promise<string | undefined> =>
      ipcRenderer.invoke(IPC_CHANNELS.externalChoose, tool),
    launch: (tool: ExternalTool): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.externalLaunch, tool),
  }),
  diagnostics: Object.freeze({
    exportReport: (markdown: string): Promise<string | undefined> =>
      ipcRenderer.invoke(IPC_CHANNELS.diagnosticsExport, markdown),
  }),
  project: Object.freeze({
    addImport: (request: AddImportRequest): Promise<ProjectChangePreview> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectAddImport, request),
    applyPreview: (previewId: string): Promise<ProjectOpenResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectApplyPreview, previewId),
    confirmSourceImport: (): Promise<ProjectChangePreview> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectConfirmSourceImport),
    chooseDirectory: (): Promise<DirectorySelection> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectChooseDirectory),
    create: (request: CreateProjectRequest): Promise<ProjectOpenResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectCreate, request),
    openDroppedFile: (file: File): Promise<ProjectOpenResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectOpenPath, webUtils.getPathForFile(file)),
    openPath: (projectPath: string): Promise<ProjectOpenResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectOpenPath, projectPath),
    refresh: (): Promise<ProjectOpenResult> => ipcRenderer.invoke(IPC_CHANNELS.projectRefresh),
    resolveExternal: (request: ExternalConflictRequest): Promise<ExternalConflictResult> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectResolveExternal, request),
    migrate: (): Promise<ProjectOpenResult> => ipcRenderer.invoke(IPC_CHANNELS.projectMigrate),
    discardPreview: (previewId: string): Promise<void> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectDiscardPreview, previewId),
    previewCommand: (command: DomainCommand): Promise<ProjectChangePreview> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectPreviewCommand, command),
    previewDocSupplement: (request: DocSupplementRequest): Promise<ProjectChangePreview> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectPreviewDocSupplement, request),
    readDocSupplement: (filePath: string): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.projectReadDocSupplement, filePath),
    onOpened: (listener: (project: ProjectOpenResult) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, project: ProjectOpenResult) =>
        listener(project);
      ipcRenderer.on(IPC_CHANNELS.projectOpened, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.projectOpened, handler);
    },
    onFilesChanged: (listener: (events: readonly ProjectFileEventView[]) => void): (() => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        events: readonly ProjectFileEventView[],
      ) => listener(events);
      ipcRenderer.on(IPC_CHANNELS.projectFilesChanged, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.projectFilesChanged, handler);
    },
  }),
  nt: Object.freeze({
    connect: (request: NtConnectRequest): Promise<NtSnapshotView> =>
      ipcRenderer.invoke(IPC_CHANNELS.ntConnect, request),
    disconnect: (): Promise<NtSnapshotView> => ipcRenderer.invoke(IPC_CHANNELS.ntDisconnect),
    snapshot: (): Promise<NtSnapshotView> => ipcRenderer.invoke(IPC_CHANNELS.ntSnapshot),
    startCalibrationTest: (request: CalibrationTestRequest): Promise<NtSnapshotView> =>
      ipcRenderer.invoke(IPC_CHANNELS.ntCalibrationStart, request),
    stopCalibrationTest: (): Promise<NtSnapshotView> =>
      ipcRenderer.invoke(IPC_CHANNELS.ntCalibrationStop),
  }),
  toolchain: Object.freeze({
    cancel: (): Promise<ToolchainSnapshotView> => ipcRenderer.invoke(IPC_CHANNELS.toolchainCancel),
    info: (): Promise<ToolchainInfoView> => ipcRenderer.invoke(IPC_CHANNELS.toolchainInfo),
    snapshot: (): Promise<ToolchainSnapshotView> =>
      ipcRenderer.invoke(IPC_CHANNELS.toolchainSnapshot),
    start: (task: ToolchainTask, confirmed: boolean): Promise<ToolchainSnapshotView> =>
      ipcRenderer.invoke(IPC_CHANNELS.toolchainStart, task, confirmed),
  }),
  recent: Object.freeze({
    list: (): Promise<readonly RecentProject[]> => ipcRenderer.invoke(IPC_CHANNELS.recentList),
    relink: (oldPath: string): Promise<readonly RecentProject[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.recentRelink, oldPath),
    remove: (projectPath: string): Promise<readonly RecentProject[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.recentRemove, projectPath),
  }),
  settings: Object.freeze({
    get: (): Promise<AppSettings> => ipcRenderer.invoke(IPC_CHANNELS.settingsGet),
    update: (changes: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke(IPC_CHANNELS.settingsUpdate, changes),
  }),
  window: Object.freeze({
    close: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.windowClose),
    getState: (): Promise<WindowState> => ipcRenderer.invoke(IPC_CHANNELS.windowGetState),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.windowIsMaximized),
    minimize: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.windowMinimize),
    onMaximizedChanged: (listener: (maximized: boolean) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, maximized: boolean) =>
        listener(maximized);
      ipcRenderer.on(IPC_CHANNELS.windowMaximizedChanged, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.windowMaximizedChanged, handler);
    },
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.windowToggleMaximize),
    updateState: (changes: Partial<WindowState>): Promise<WindowState> =>
      ipcRenderer.invoke(IPC_CHANNELS.windowUpdateState, changes),
  }),
});

contextBridge.exposeInMainWorld('framework', frameworkApi);
