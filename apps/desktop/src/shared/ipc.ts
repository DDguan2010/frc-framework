import type { AppInfo, DomainCommand, FrcProjectModel } from '@frc-framework/domain';
import type { FileChange, ProjectFileKind } from '@frc-framework/project-io';
import type { NtConnectionState, NtType, NtValue } from '@frc-framework/nt-client';
import type { GradleDiagnostic, JavaCandidate } from '@frc-framework/toolchain';

export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  appCheckUpdates: 'app:check-updates',
  editorDetect: 'editor:detect',
  editorOpen: 'editor:open',
  externalLaunch: 'external:launch',
  externalChoose: 'external:choose',
  diagnosticsExport: 'diagnostics:export',
  projectChooseDirectory: 'project:choose-directory',
  projectCreate: 'project:create',
  projectApplyPreview: 'project:apply-preview',
  projectAddImport: 'project:add-import',
  projectConfirmSourceImport: 'project:confirm-source-import',
  projectDiscardPreview: 'project:discard-preview',
  projectOpenPath: 'project:open-path',
  projectMigrate: 'project:migrate',
  projectOpened: 'project:opened',
  projectFilesChanged: 'project:files-changed',
  projectRefresh: 'project:refresh',
  projectResolveExternal: 'project:resolve-external',
  projectPreviewCommand: 'project:preview-command',
  projectPreviewDocSupplement: 'project:preview-doc-supplement',
  projectReadDocSupplement: 'project:read-doc-supplement',
  ntConnect: 'nt:connect',
  ntDisconnect: 'nt:disconnect',
  ntSnapshot: 'nt:snapshot',
  ntCalibrationStart: 'nt:calibration-start',
  ntCalibrationStop: 'nt:calibration-stop',
  toolchainCancel: 'toolchain:cancel',
  toolchainInfo: 'toolchain:info',
  toolchainSnapshot: 'toolchain:snapshot',
  toolchainStart: 'toolchain:start',
  recentList: 'recent:list',
  recentRelink: 'recent:relink',
  recentRemove: 'recent:remove',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  windowClose: 'window:close',
  windowGetState: 'window:get-state',
  windowIsMaximized: 'window:is-maximized',
  windowMaximizedChanged: 'window:maximized-changed',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowUpdateState: 'window:update-state',
} as const;

export type DirectoryKind = 'empty' | 'frc-project' | 'directory';
export type AppLanguage = 'system' | 'en' | 'zh-CN';
export type ThemePreference = 'dark' | 'system';
export type InterfaceDensity = 'comfortable' | 'compact';
export type LogLevel = 'debug' | 'info' | 'warning' | 'error';
export type ExternalTool = 'advantagescope' | 'pathplanner';

export interface ExternalToolConfiguration {
  readonly mode: 'auto' | 'custom';
  readonly executable?: string;
}

export interface UpdateCheckResult {
  readonly currentVersion: string;
  readonly latestVersion?: string;
  readonly releaseUrl?: string;
  readonly releasePublished: boolean;
  readonly updateAvailable: boolean;
  readonly checkedAt: string;
}

export interface EditorConfiguration {
  readonly id: string;
  readonly name: string;
  readonly executable: string;
  readonly arguments: readonly string[];
}

export type EditorCandidate = EditorConfiguration;

export interface EditorOpenRequest {
  readonly file: string;
  readonly line?: number;
  readonly column?: number;
  readonly project: string;
}

export interface DefaultProjectSettings {
  readonly teamNumber: number;
  readonly javaPackage: string;
  readonly wpilibYear: number;
}

export interface ProjectWorkspaceState {
  readonly treeMode: 'logic' | 'source';
  readonly expandedEntityIds: readonly string[];
  readonly expandedSourcePaths?: readonly string[];
}

export interface AppSettings {
  readonly language: AppLanguage;
  readonly theme: ThemePreference;
  readonly density: InterfaceDensity;
  readonly logLevel: LogLevel;
  readonly previewChanges: boolean;
  readonly autoApplySafeChanges: boolean;
  readonly defaultProject: DefaultProjectSettings;
  readonly projectUi: Readonly<Record<string, ProjectWorkspaceState>>;
  readonly projectEditors: Readonly<Record<string, string>>;
  readonly externalTools: Readonly<Record<ExternalTool, ExternalToolConfiguration>>;
  readonly editor?: EditorConfiguration;
}

export interface WindowState {
  readonly width: number;
  readonly height: number;
  readonly x?: number;
  readonly y?: number;
  readonly maximized: boolean;
  readonly leftPanelWidth: number;
  readonly inspectorWidth: number;
  readonly bottomPanelHeight: number;
}

export interface DirectorySelection {
  readonly canceled: boolean;
  readonly path?: string;
  readonly kind?: DirectoryKind;
  readonly entryCount?: number;
  readonly displayName?: string;
}

export interface RecentProject {
  readonly path: string;
  readonly displayName: string;
  readonly lastOpenedAt: string;
  readonly available: boolean;
}

export interface CreateProjectRequest {
  readonly path: string;
  readonly name: string;
  readonly teamNumber: number;
  readonly javaPackage: string;
  readonly wpilibYear: number;
}

export interface ProjectOpenResult {
  readonly path: string;
  readonly displayName: string;
  readonly mode: 'yaml' | 'source';
  readonly readOnly: boolean;
  readonly problems: readonly string[];
  readonly model?: FrcProjectModel;
  readonly sourceFiles: readonly ProjectSourceFile[];
  readonly sourceBrowseOnly?: boolean;
  readonly needsImportConfirmation?: boolean;
  readonly sourceImport?: SourceImportSummary;
  readonly migration?: {
    readonly supported: boolean;
    readonly fromVersion: number | 'unversioned';
    readonly toVersion: number;
    readonly summary: readonly string[];
  };
}

export interface SourceImportSummary {
  readonly recognizedFiles: number;
  readonly partialFiles: number;
  readonly customFiles: number;
  readonly vendordeps: readonly string[];
}

export interface ProjectSourceFile {
  readonly path: string;
  readonly kind: ProjectFileKind;
  readonly format: string;
  readonly binary: boolean;
  readonly size: number;
  readonly ownership: 'managed' | 'recognized' | 'custom';
  readonly problemCount: number;
  readonly externallyModified: boolean;
  readonly symbols?: readonly {
    readonly label: string;
    readonly kind: 'type' | 'field' | 'method' | 'command' | 'binding' | 'state';
    readonly line: number;
    readonly column: number;
  }[];
}

export type ProjectFileEventKind = 'add' | 'change' | 'unlink';

export interface ProjectFileEventView {
  readonly kind: ProjectFileEventKind;
  readonly path: string;
  readonly external: boolean;
  readonly conflict: boolean;
}

export type ExternalConflictAction = 'reload' | 'compare' | 'keep-code' | 'regenerate';

export interface ExternalConflictRequest {
  readonly action: ExternalConflictAction;
  readonly paths: readonly string[];
}

export interface ExternalConflictResult {
  readonly project?: ProjectOpenResult;
  readonly preview?: ProjectChangePreview;
}

export interface ProjectChangePreview {
  readonly id: string;
  readonly model: FrcProjectModel;
  readonly changes: readonly FileChange[];
  readonly problems: readonly string[];
  readonly safeToApply: boolean;
}

export interface AddImportRequest {
  readonly file: string;
  readonly importName: string;
  readonly isStatic: boolean;
}

export interface DocSupplementRequest {
  readonly path: string;
  readonly markdown: string;
}

export interface NtConnectRequest {
  readonly host: string;
  readonly prefixes: readonly string[];
}

export interface CalibrationTestRequest {
  readonly deviceId: string;
  readonly output: number;
  readonly durationSeconds: number;
  readonly confirmed: boolean;
}

export interface NtLiveValueView {
  readonly path: string;
  readonly type: NtType;
  readonly value: NtValue;
  readonly updatedAtMillis: number;
}

export interface NtSnapshotView {
  readonly state: NtConnectionState | 'stale';
  readonly detail?: string;
  readonly lastUpdatedAtMillis?: number;
  readonly values: readonly NtLiveValueView[];
}

export type ToolchainTask = 'spotless' | 'compile' | 'test' | 'simulate' | 'deploy' | 'validate';

export interface ToolchainInfoView {
  readonly projectYear: number;
  readonly requiredMajor: number;
  readonly selected?: JavaCandidate;
  readonly candidates: readonly JavaCandidate[];
  readonly diagnostics: readonly string[];
  readonly deploy: {
    readonly teamNumber: number;
    readonly target: string;
    readonly gitBranch?: string;
    readonly gitDirty: boolean;
    readonly pendingStructuredChanges: boolean;
    readonly externallyModifiedFiles: number;
    readonly lastBuildState?: ToolchainRunView['state'];
    readonly lastBuildAt?: string;
  };
}

export interface ToolchainRunView {
  readonly id: string;
  readonly task: ToolchainTask;
  readonly state: 'running' | 'success' | 'failed' | 'cancelled';
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  readonly output: string;
  readonly diagnostics: readonly GradleDiagnostic[];
}

export interface ToolchainSnapshotView {
  readonly active?: ToolchainRunView;
  readonly recent: readonly ToolchainRunView[];
}

export interface FrameworkApi {
  readonly app: {
    getInfo(): Promise<AppInfo>;
    checkUpdates(): Promise<UpdateCheckResult>;
  };
  readonly editor: {
    detect(): Promise<readonly EditorCandidate[]>;
    open(
      configuration: EditorConfiguration,
      request: EditorOpenRequest,
    ): Promise<number | undefined>;
  };
  readonly external: {
    launch(tool: ExternalTool): Promise<void>;
    choose(tool: ExternalTool): Promise<string | undefined>;
  };
  readonly diagnostics: {
    exportReport(markdown: string): Promise<string | undefined>;
  };
  readonly project: {
    applyPreview(previewId: string): Promise<ProjectOpenResult>;
    addImport(request: AddImportRequest): Promise<ProjectChangePreview>;
    confirmSourceImport(): Promise<ProjectChangePreview>;
    chooseDirectory(): Promise<DirectorySelection>;
    create(request: CreateProjectRequest): Promise<ProjectOpenResult>;
    openDroppedFile(file: File): Promise<ProjectOpenResult>;
    openPath(projectPath: string): Promise<ProjectOpenResult>;
    refresh(): Promise<ProjectOpenResult>;
    resolveExternal(request: ExternalConflictRequest): Promise<ExternalConflictResult>;
    migrate(): Promise<ProjectOpenResult>;
    discardPreview(previewId: string): Promise<void>;
    previewCommand(command: DomainCommand): Promise<ProjectChangePreview>;
    previewDocSupplement(request: DocSupplementRequest): Promise<ProjectChangePreview>;
    readDocSupplement(path: string): Promise<string>;
    onOpened(listener: (project: ProjectOpenResult) => void): () => void;
    onFilesChanged(listener: (events: readonly ProjectFileEventView[]) => void): () => void;
  };
  readonly nt: {
    connect(request: NtConnectRequest): Promise<NtSnapshotView>;
    disconnect(): Promise<NtSnapshotView>;
    snapshot(): Promise<NtSnapshotView>;
    startCalibrationTest(request: CalibrationTestRequest): Promise<NtSnapshotView>;
    stopCalibrationTest(): Promise<NtSnapshotView>;
  };
  readonly toolchain: {
    info(): Promise<ToolchainInfoView>;
    start(task: ToolchainTask, confirmed: boolean): Promise<ToolchainSnapshotView>;
    cancel(): Promise<ToolchainSnapshotView>;
    snapshot(): Promise<ToolchainSnapshotView>;
  };
  readonly recent: {
    list(): Promise<readonly RecentProject[]>;
    relink(oldPath: string): Promise<readonly RecentProject[]>;
    remove(projectPath: string): Promise<readonly RecentProject[]>;
  };
  readonly settings: {
    get(): Promise<AppSettings>;
    update(changes: Partial<AppSettings>): Promise<AppSettings>;
  };
  readonly window: {
    close(): Promise<void>;
    getState(): Promise<WindowState>;
    isMaximized(): Promise<boolean>;
    minimize(): Promise<void>;
    onMaximizedChanged(listener: (maximized: boolean) => void): () => void;
    toggleMaximize(): Promise<boolean>;
    updateState(changes: Partial<WindowState>): Promise<WindowState>;
  };
}
