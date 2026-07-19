import { I18n, resolveLocale, type TranslationKey } from '@frc-framework/i18n';
import {
  createEntityId,
  javaSymbol,
  planSubsystemRemoval,
  removeSubsystemState,
  subsystemJavaLocation,
  subsystemUsesAutomaticJavaLocation,
  validateModel,
  type AppInfo,
  type Device,
  type CommandDefinition,
  type Controller,
  type DomainCommand,
  type FrcProjectModel,
  type Subsystem,
} from '@frc-framework/domain';
import {
  COMPONENT_CATALOG,
  findComponentDefinition,
  instantiateCatalogDevice,
  validateHardware,
  type CatalogParameterDefinition,
} from '@frc-framework/frc-catalog';
import {
  instantiateLimelightPreset,
  instantiateCommonPreset,
  instantiateSwervePreset,
  PRESET_MANIFESTS,
  type CommonPresetId,
} from '@frc-framework/presets';
import {
  collectTuningParameters,
  compareTuningValues,
  createSaveTuningSnapshotCommand,
  createWriteNtValuesCommand,
  type LiveTuningValue,
  type TuningComparison,
} from '@frc-framework/nt-client/tuning';
import { css, html, LitElement, nothing, type TemplateResult } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { keyed } from 'lit/directives/keyed.js';

import frameworkLogo from '../assets/frameworklogo.svg?url';
import { projectTreeIcon } from './project-tree-icons.js';

import type {
  AppSettings,
  DirectorySelection,
  EditorCandidate,
  EditorConfiguration,
  ProjectChangePreview,
  ProjectOpenResult,
  ProjectSourceFile,
  RecentProject,
  WindowState,
  NtSnapshotView,
  ToolchainInfoView,
  ToolchainSnapshotView,
  ToolchainTask,
  ProjectFileEventView,
  ExternalConflictAction,
  UpdateCheckResult,
} from '../../shared/ipc.js';

const navigation = [
  ['project', 'nav.project'],
  ['controls', 'nav.controls'],
  ['commands', 'nav.commands'],
  ['presets', 'nav.presets'],
  ['auto', 'nav.auto'],
  ['tuning', 'nav.tuning'],
  ['calibration', 'nav.calibration'],
  ['docs', 'nav.docs'],
  ['problems', 'nav.problems'],
  ['toolchain', 'nav.toolchain'],
] as const satisfies readonly (readonly [string, TranslationKey])[];

const fallbackSettings: AppSettings = {
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

const fallbackWindow: WindowState = {
  bottomPanelHeight: 180,
  height: 800,
  inspectorWidth: 300,
  leftPanelWidth: 176,
  maximized: false,
  width: 1360,
};

const PANEL_LAYOUT = {
  inspectorMaximum: 840,
  inspectorMinimum: 240,
  leftMaximum: 720,
  leftMinimum: 120,
  workspaceMinimum: 360,
} as const;

@customElement('frc-framework-app')
export class AppShell extends LitElement {
  static override styles = css`
    :host {
      --bottom-height: 180px;
      --inspector-width: 300px;
      --left-width: 176px;
      display: block;
      height: 100vh;
      min-height: 640px;
    }

    :host([density='compact']) {
      --app-section-gap: 12px;
    }

    .shell {
      background: var(--app-surface);
      color: var(--md-sys-color-on-surface);
      display: grid;
      grid-template-areas:
        'top top top'
        'nav content inspector'
        'nav bottom inspector';
      grid-template-columns: var(--left-width) minmax(360px, 1fr) var(--inspector-width);
      grid-template-rows: 64px minmax(0, 1fr) var(--bottom-height);
      height: 100%;
      overflow: hidden;
    }

    .top-bar {
      align-items: center;
      background: var(--md-sys-color-surface-container-low);
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
      display: flex;
      gap: 10px;
      grid-area: top;
      padding: 0 18px;
    }

    .brand {
      align-items: center;
      display: flex;
      gap: 12px;
      margin-right: auto;
      min-width: 220px;
    }

    .mark {
      align-items: center;
      display: inline-flex;
      height: 36px;
      justify-content: center;
      width: 36px;
    }

    .mark img {
      display: block;
      height: 32px;
      object-fit: contain;
      width: 32px;
    }

    .brand-copy {
      display: grid;
      gap: 1px;
      min-width: 0;
    }

    .brand-copy strong {
      font-size: 14px;
      letter-spacing: 0.01em;
    }

    .brand-copy span,
    .muted {
      color: var(--md-sys-color-on-surface-variant);
      font-size: 12px;
    }

    nav {
      background: var(--md-sys-color-surface-container-low);
      border-right: 1px solid var(--md-sys-color-outline-variant);
      display: flex;
      flex-direction: column;
      grid-area: nav;
      min-width: 0;
      overflow: hidden auto;
      padding: 10px 8px;
    }

    nav md-list {
      background: transparent;
      padding: 0;
    }

    nav md-list-item {
      border-radius: 12px;
      min-height: 48px;
      --md-list-item-container-color: transparent;
    }

    nav md-list-item[aria-current='page'] {
      --md-list-item-container-color: var(--md-sys-color-secondary-container);
      --md-list-item-label-text-color: var(--md-sys-color-on-secondary-container);
    }

    .nav-index {
      color: var(--md-sys-color-on-surface-variant);
      font-family: var(--app-font-mono);
      font-size: 10px;
      width: 22px;
    }

    .nav-bottom {
      margin-top: auto;
    }

    main {
      grid-area: content;
      min-width: 0;
      overflow: auto;
      padding: 24px;
    }

    .eyebrow {
      color: var(--md-sys-color-on-surface-variant);
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.12em;
      margin: 0 0 8px;
      text-transform: uppercase;
    }

    h1 {
      font-size: clamp(25px, 3vw, 38px);
      font-weight: 500;
      letter-spacing: -0.035em;
      line-height: 1.1;
      margin: 0;
    }

    .lead {
      color: var(--md-sys-color-on-surface-variant);
      line-height: 1.65;
      margin: 14px 0 24px;
      max-width: 760px;
    }

    .actions,
    .dialog-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .actions {
      margin-bottom: 24px;
    }

    .workspace-card,
    .recent-card {
      background: var(--md-sys-color-surface-container);
      border: 1px solid var(--md-sys-color-outline-variant);
      border-radius: 16px;
      display: grid;
      gap: 16px;
      margin-bottom: 16px;
      padding: 20px;
    }

    .workspace-card header,
    .recent-card header,
    .row {
      align-items: center;
      display: flex;
      gap: 12px;
      justify-content: space-between;
    }

    h2,
    aside h2,
    .bottom-panel h2 {
      font-size: 13px;
      font-weight: 650;
      margin: 0;
    }

    .path {
      background: var(--md-sys-color-surface-container-lowest);
      border-radius: 8px;
      color: var(--md-sys-color-on-surface-variant);
      font-family: var(--app-font-mono);
      font-size: 11px;
      overflow: hidden;
      padding: 10px 12px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .component-preview,
    .settings-grid {
      display: grid;
      gap: 18px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .field-stack,
    .dialog-form {
      display: grid;
      gap: 14px;
    }

    .control-row {
      align-items: center;
      display: flex;
      gap: 12px;
      min-height: 48px;
    }

    .recent-card md-list {
      background: transparent;
      padding: 0;
    }

    .recent-path {
      color: var(--md-sys-color-on-surface-variant);
      font-family: var(--app-font-mono);
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .unavailable {
      color: var(--md-sys-color-error);
    }

    .tuning-table {
      border-collapse: collapse;
      font-size: 12px;
      min-width: 920px;
      width: 100%;
    }

    .tuning-table th,
    .tuning-table td {
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
      padding: 10px 8px;
      text-align: left;
      vertical-align: middle;
    }

    .tuning-table code {
      color: var(--md-sys-color-on-surface-variant);
      font-family: var(--app-font-mono);
      white-space: nowrap;
    }

    .task-output {
      background: var(--md-sys-color-surface-container-lowest);
      border-radius: 8px;
      color: var(--md-sys-color-on-surface-variant);
      font-family: var(--app-font-mono);
      max-height: 360px;
      overflow: auto;
      padding: 12px;
      white-space: pre-wrap;
    }

    aside {
      background: var(--md-sys-color-surface-container-low);
      border-left: 1px solid var(--md-sys-color-outline-variant);
      grid-area: inspector;
      min-width: 0;
      overflow: auto;
      padding: 18px;
    }

    .inspector-section {
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
      display: grid;
      gap: 14px;
      padding: 18px 0;
    }

    .bottom-panel {
      background: var(--md-sys-color-surface-container-lowest);
      border-top: 1px solid var(--md-sys-color-outline-variant);
      grid-area: bottom;
      overflow: auto;
    }

    .bottom-panel md-tabs {
      border-bottom: 1px solid var(--md-sys-color-outline-variant);
      max-width: 560px;
    }

    .status-content {
      align-items: center;
      color: var(--md-sys-color-on-surface-variant);
      display: flex;
      font-size: 12px;
      gap: 10px;
      padding: 18px 22px;
    }

    .status-dot {
      background: var(--app-status-ok);
      border-radius: 50%;
      flex: 0 0 auto;
      height: 7px;
      width: 7px;
    }

    .status-dot.error {
      background: var(--md-sys-color-error);
    }

    .resize-handle {
      position: fixed;
      touch-action: none;
      z-index: 5;
    }

    .resize-handle::after {
      background: transparent;
      content: '';
      position: absolute;
    }

    .resize-handle:hover,
    .resize-handle:focus-visible {
      outline: none;
    }

    .resize-handle:hover::after,
    .resize-handle:focus-visible::after {
      background: var(--md-sys-color-primary);
    }

    .resize-left {
      bottom: 0;
      cursor: col-resize;
      left: calc(var(--left-width) - 5px);
      top: 64px;
      width: 10px;
    }

    .resize-left::after,
    .resize-inspector::after {
      bottom: 0;
      left: 4px;
      top: 0;
      width: 2px;
    }

    .resize-inspector {
      bottom: 0;
      cursor: col-resize;
      right: calc(var(--inspector-width) - 5px);
      top: 64px;
      width: 10px;
    }

    .resize-bottom {
      bottom: calc(var(--bottom-height) - 5px);
      cursor: row-resize;
      height: 10px;
      left: var(--left-width);
      right: var(--inspector-width);
    }

    .resize-bottom::after {
      height: 2px;
      left: 0;
      right: 0;
      top: 4px;
    }

    md-outlined-text-field,
    md-outlined-select {
      width: 100%;
    }

    .dialog-form {
      min-width: min(520px, 72vw);
      padding-top: 4px;
    }

    .shortcut {
      align-items: center;
      display: flex;
      justify-content: space-between;
      min-height: 42px;
    }

    kbd {
      background: var(--md-sys-color-surface-container-high);
      border: 1px solid var(--md-sys-color-outline-variant);
      border-radius: 6px;
      font-family: var(--app-font-mono);
      padding: 4px 7px;
    }

    .tree-panel {
      border-top: 1px solid var(--md-sys-color-outline-variant);
      display: grid;
      gap: 8px;
      margin-top: 10px;
      padding-top: 10px;
    }

    .tree-toolbar,
    .workspace-heading,
    .preview-actions {
      align-items: center;
      display: flex;
      gap: 8px;
    }

    .tree-search {
      --md-outlined-field-bottom-space: 7px;
      --md-outlined-field-top-space: 7px;
    }

    .tree-node {
      align-items: center;
      background: transparent;
      border: 0;
      border-radius: 8px;
      color: inherit;
      cursor: pointer;
      display: grid;
      font: inherit;
      gap: 7px;
      grid-template-columns: 18px 18px minmax(0, 1fr) auto;
      min-height: 34px;
      padding: 5px 7px;
      text-align: left;
      width: 100%;
    }

    .tree-node-wrap {
      align-items: center;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 34px;
    }

    .tree-node-wrap > .tree-node {
      padding-left: 0;
    }

    .tree-node:hover,
    .tree-node[selected] {
      background: var(--md-sys-color-surface-container-high);
    }

    .tree-node md-icon {
      font-size: 17px;
    }

    .tree-node-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tree-badge,
    .ownership {
      color: var(--md-sys-color-on-surface-variant);
      font-family: var(--app-font-mono);
      font-size: 9px;
      text-transform: uppercase;
    }

    .structured-workspace {
      display: grid;
      gap: 16px;
    }

    .workspace-heading {
      justify-content: space-between;
    }

    .summary-grid {
      display: grid;
      gap: 12px;
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }

    .summary-card {
      background: var(--md-sys-color-surface-container);
      border: 1px solid var(--md-sys-color-outline-variant);
      border-radius: 12px;
      display: grid;
      gap: 5px;
      padding: 16px;
    }

    .summary-card strong {
      font-size: 22px;
      font-weight: 500;
    }

    .hierarchy-list,
    .parameter-list,
    .diff-list {
      display: grid;
      gap: 8px;
    }

    .hierarchy-row,
    .parameter-row,
    .diff-row {
      align-items: center;
      background: var(--md-sys-color-surface-container);
      border: 1px solid var(--md-sys-color-outline-variant);
      border-radius: 10px;
      display: grid;
      gap: 10px;
      grid-template-columns: minmax(0, 1fr) auto;
      padding: 11px 13px;
    }

    .parameter-row {
      align-items: stretch;
      grid-template-columns: minmax(0, 1fr);
      padding: 12px;
    }

    .parameter-copy,
    .diff-content {
      display: grid;
      gap: 6px;
    }

    .parameter-description {
      line-height: 1.45;
    }

    .parameter-control-row {
      align-items: center;
      display: grid;
      gap: 8px;
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .parameter-control-row md-outlined-text-field,
    .parameter-control-row md-outlined-select {
      min-width: 0;
      width: 100%;
    }

    .parameter-nt-state {
      align-items: center;
      display: flex;
      gap: 6px;
    }

    .summary-card p {
      line-height: 1.5;
      margin: 0;
    }

    .diff-content {
      padding: 12px 18px 18px;
    }

    .diff-row code {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .line-diff {
      background: var(--md-sys-color-surface-container-low);
      border-radius: 6px;
      display: grid;
      font-family: var(--app-font-mono);
      font-size: 10px;
      gap: 2px;
      grid-column: 1 / -1;
      max-height: 100px;
      overflow: auto;
      padding: 7px;
    }

    .line-added {
      color: var(--app-status-ok);
    }

    .line-removed {
      color: var(--md-sys-color-error);
    }

    .problem-text {
      color: var(--md-sys-color-error);
      font-size: 12px;
    }

    @media (max-width: 1120px) {
      .shell {
        grid-template-areas:
          'top top top'
          'nav content inspector'
          'nav bottom inspector';
        grid-template-columns:
          var(--left-width) minmax(320px, 1fr)
          var(--inspector-width);
      }

      main {
        padding: 16px;
      }
    }

    @media (max-width: 760px) {
      .shell {
        grid-template-areas:
          'top top'
          'nav content'
          'nav bottom';
        grid-template-columns: 72px minmax(0, 1fr);
      }

      aside {
        display: none;
      }

      .resize-handle {
        display: none;
      }

      nav [slot='headline'] {
        display: none;
      }

      .component-preview,
      .settings-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      * {
        scroll-behavior: auto !important;
      }
    }
  `;

  readonly #i18n = new I18n(resolveLocale(navigator.language));
  readonly #keyHandler = (event: KeyboardEvent) => this.onKeyDown(event);
  #preferredPanelWidths = {
    inspectorWidth: fallbackWindow.inspectorWidth,
    leftPanelWidth: fallbackWindow.leftPanelWidth,
  };
  readonly #windowResizeHandler = (): void => {
    this.layout = constrainPanelLayout(
      { ...this.layout, ...this.#preferredPanelWidths },
      window.innerWidth,
    );
  };
  #removeProjectListener: (() => void) | undefined;
  #removeFilesChangedListener: (() => void) | undefined;
  #ntTimer: ReturnType<typeof setInterval> | undefined;
  #toolchainTimer: ReturnType<typeof setInterval> | undefined;
  #sourceSyncTimer: ReturnType<typeof setTimeout> | undefined;

  @state() private activePage = 'project';
  @state() private directorySelection: DirectorySelection | undefined;
  @state() private project: ProjectOpenResult | undefined;
  @state() private recentProjects: readonly RecentProject[] = [];
  @state() private editors: readonly EditorCandidate[] = [];
  @state() private settings: AppSettings = fallbackSettings;
  @state() private layout: WindowState = fallbackWindow;
  @state() private working = false;
  @state() private notice = '';
  @state() private noticeError = false;
  @state() private createName = 'My Robot';
  @state() private createTeam = '0';
  @state() private createPackage = 'frc.robot';
  @state() private createYear = '2026';
  @state() private customEditorExecutable = '';
  @state() private customEditorArguments = '--goto\n{file}:{line}:{column}\n{project}';
  @state() private treeMode: 'logic' | 'source' = 'logic';
  @state() private treeSearch = '';
  @state() private treeRowLimit = 250;
  @state() private expandedEntityIds = new Set<string>();
  @state() private expandedSourcePaths = new Set<string>();
  @state() private selectedEntityId: string | undefined;
  @state() private selectedSourcePath: string | undefined;
  @state() private preview: ProjectChangePreview | undefined;
  private previewSelectionId: string | undefined;
  @state() private diffFilter = '';
  @state() private subsystemName = '';
  @state() private subsystemKind: Subsystem['kind'] = 'subsystem';
  @state() private subsystemBehavior: NonNullable<Subsystem['behaviorMode']> = 'direct';
  @state() private subsystemParentId = '';
  @state() private subsystemReal = true;
  @state() private subsystemSim = true;
  @state() private mechanismName = '';
  @state() private mechanismParentId = '';
  @state() private mechanismNotes = '';
  @state() private goalName = '';
  @state() private deviceName = '';
  @state() private deviceCatalogId = 'ironpulse.talonfx-primary';
  @state() private deviceCanId = '0';
  @state() private deviceCanBus = 'rio';
  @state() private deviceLeaderId = '';
  @state() private deviceOpposeLeader = false;
  @state() private importName = '';
  @state() private importStatic = false;
  @state() private controllerName = '';
  @state() private controllerProvider = 'CommandXboxController';
  @state() private controllerPort = '0';
  @state() private controllerRole: Controller['role'] = 'driver';
  @state() private controllerLayout = '';
  @state() private commandName = '';
  @state() private commandKind: CommandDefinition['kind'] = 'custom';
  @state() private commandRequirementId = '';
  @state() private commandExpression = '';
  @state() private commandFactory = true;
  @state() private commandPathplannerName = '';
  @state() private bindingControllerId = '';
  @state() private bindingInput = '';
  @state() private bindingBehavior: FrcProjectModel['bindings'][number]['behavior'] = 'onTrue';
  @state() private bindingCommandId = '';
  @state() private autoName = '';
  @state() private autoCommandId = '';
  @state() private autoPathFiles = '';
  @state() private draggedEntityId: string | undefined;
  @state() private presetKind: string = 'frc.swerve';
  @state() private commonPresetName = 'Mechanism';
  @state() private commonPresetParentId = '';
  @state() private commonPresetCanId = '20';
  @state() private commonPresetCanBus = 'rio';
  @state() private commonPresetFollowers = '';
  @state() private commonPresetChannel = '0';
  @state() private commonPresetSetpoints = 'IDLE=0, ACTIVE=1';
  @state() private commonPresetUnit = 'rot';
  @state() private swerveGeometry = '0.55, 0.55, 0.0508';
  @state() private swerveMaxSpeed = '4.5';
  @state() private swerveDriveRatio = '6.75';
  @state() private swerveSteerRatio = '21.428';
  @state() private swerveCanBus = 'rio';
  @state() private swerveGyroId = '13';
  @state() private swerveDriveIds = '1, 2, 3, 4';
  @state() private swerveSteerIds = '5, 6, 7, 8';
  @state() private swerveEncoderIds = '9, 10, 11, 12';
  @state() private swerveOffsets = '0, 0, 0, 0';
  @state() private swerveDriveGains = '0, 0';
  @state() private swerveSteerGains = '0, 0';
  @state() private swervePathGains = '5, 5';
  @state() private swerveCurrentLimits = '80, 40';
  @state() private swerveGyroMount = '0, 0, 0';
  @state() private swerveDriveInverted = false;
  @state() private swerveSteerInverted = false;
  @state() private limelightDeviceName = 'Front Limelight';
  @state() private limelightTable = 'limelight-front';
  @state() private limelightPipelineStream = '0, 0';
  @state() private limelightTransform = '0, 0, 0, 0, 0, 0';
  @state() private ntHost = '127.0.0.1';
  @state() private ntSnapshot: NtSnapshotView | undefined;
  @state() private ntOnlyDifferent = true;
  @state() private ntSearch = '';
  @state() private ntSubsystem = '';
  @state() private ntType = '';
  @state() private ntSelected = new Set<string>();
  @state() private ntSnapshotName = '';
  @state() private calibrationDeviceId = '';
  @state() private calibrationOutput = '0.1';
  @state() private calibrationDuration = '0.5';
  @state() private calibrationConfirmed = false;
  @state() private ntWriteValidation: 'idle' | 'pending' | 'running' | 'success' | 'failed' =
    'idle';
  private pendingNtValidation = false;
  @state() private toolchainInfo: ToolchainInfoView | undefined;
  @state() private toolchainSnapshot: ToolchainSnapshotView | undefined;
  @state() private selectedDocPath: string | undefined;
  @state() private docSupplement = '';
  @state() private deleteImpact:
    | {
        readonly command: DomainCommand;
        readonly id: string;
        readonly label: string;
        readonly references: readonly string[];
        readonly files: readonly string[];
      }
    | undefined;
  @state() private referenceImpact:
    | {
        readonly sourceId: string;
        readonly targetId: string;
        readonly graph: readonly string[];
        readonly files: readonly string[];
      }
    | undefined;
  @state() private externalChanges: readonly ProjectFileEventView[] = [];
  @state() private appInfo: AppInfo | undefined;
  @state() private updateCheck: UpdateCheckResult | undefined;

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this.#keyHandler);
    window.addEventListener('resize', this.#windowResizeHandler);
    this.#removeProjectListener = window.framework.project.onOpened((project) => {
      this.project = project;
      this.notice = project.path;
      this.restoreTreeState(project);
      void this.refreshRecent();
      void this.refreshToolchainInfo();
    });
    this.#removeFilesChangedListener = window.framework.project.onFilesChanged((events) => {
      const byPath = new Map(this.externalChanges.map((event) => [event.path, event]));
      for (const event of events) {
        if (event.external) byPath.set(event.path, event);
        else byPath.delete(event.path);
      }
      this.externalChanges = [...byPath.values()].sort((left, right) =>
        left.path.localeCompare(right.path),
      );
      if (this.#sourceSyncTimer !== undefined) clearTimeout(this.#sourceSyncTimer);
      if (this.externalChanges.length === 0) {
        this.#sourceSyncTimer = undefined;
        this.dialog('external-change-dialog')?.close();
        return;
      }
      this.#sourceSyncTimer = setTimeout(() => void this.synchronizeExternalSource(), 120);
    });
    void this.initialize();
  }

  private model(): FrcProjectModel | undefined {
    return this.preview?.model ?? this.project?.model;
  }

  private async synchronizeExternalSource(): Promise<void> {
    this.#sourceSyncTimer = undefined;
    if (this.project === undefined || this.externalChanges.length === 0) return;
    const selectedEntityId = this.selectedEntityId;
    const sourceOwnership = new Map(
      this.project.sourceFiles.map((file) => [file.path, file.ownership]),
    );
    const automaticallyAccepted =
      this.preview === undefined
        ? this.externalChanges
            .filter(
              (event) =>
                !event.conflict &&
                (!event.path.endsWith('.java') || sourceOwnership.get(event.path) !== 'managed'),
            )
            .map((event) => event.path)
        : [];
    await this.run(async () => {
      if (automaticallyAccepted.length > 0) {
        const result = await window.framework.project.resolveExternal({
          action: 'reload',
          paths: automaticallyAccepted,
        });
        if (result.project !== undefined) this.project = result.project;
      } else if (
        this.preview === undefined &&
        this.externalChanges.some((event) => event.path.endsWith('.java'))
      ) {
        this.project = await window.framework.project.refresh();
      }
      if (this.project !== undefined) {
        this.restoreTreeState(this.project);
        this.selectedEntityId = selectedEntityId;
      }
      this.notice =
        this.#i18n.locale === 'zh-CN'
          ? `已同步 ${String(this.externalChanges.length)} 个源码变更`
          : `Synchronized ${String(this.externalChanges.length)} source change(s)`;
    });
    const accepted = new Set(automaticallyAccepted);
    this.externalChanges = this.externalChanges.filter((event) => !accepted.has(event.path));
    if (this.externalChanges.length > 0) {
      await this.updateComplete;
      this.dialog('external-change-dialog')?.show();
    }
  }

  private renderProjectTree(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const model = this.model();
    if (model === undefined) return html``;
    const query = this.treeSearch.trim().toLowerCase();
    const rows =
      this.treeMode === 'logic' ? this.logicTreeRows(model, query) : this.sourceTreeRows(query);
    return html`<section class="tree-panel" aria-label=${t('structured.title')}>
      <div class="tree-toolbar">
        <md-text-button
          @click=${() => this.setTreeMode('logic')}
          ?disabled=${this.project?.sourceBrowseOnly === true}
          >${t('tree.logic')}</md-text-button
        >
        <md-text-button @click=${() => this.setTreeMode('source')}
          >${t('tree.source')}</md-text-button
        >
      </div>
      <md-outlined-text-field
        class="tree-search"
        label=${t('tree.search')}
        .value=${this.treeSearch}
        @input=${(event: Event) => {
          this.treeSearch = inputValue(event);
          this.treeRowLimit = 250;
        }}
      ></md-outlined-text-field>
      <div role="tree" @keydown=${this.onTreeKeyDown}>${rows.slice(0, this.treeRowLimit)}</div>
      ${
        rows.length <= this.treeRowLimit
          ? nothing
          : html`<md-text-button @click=${() => (this.treeRowLimit += 250)}
              >${this.#i18n.t('tree.showMore')}
              (${String(rows.length - this.treeRowLimit)})</md-text-button
            >`
      }
      <md-menu id="tree-actions-menu">
        <md-menu-item @click=${this.openSelectedEntityCode}
          ><div slot="headline">${t('inspector.openCode')}</div></md-menu-item
        >
        <md-menu-item @click=${this.prepareDeleteSelected}
          ><div slot="headline">${t('tree.delete')}</div></md-menu-item
        >
      </md-menu>
    </section>`;
  }

  private logicTreeRows(model: FrcProjectModel, query: string): readonly TemplateResult[] {
    const rows: TemplateResult[] = [];
    const searching = query.length > 0;
    rows.push(
      this.treeRoot(
        model.robot.id,
        model.robot.displayName,
        projectTreeIcon('robot'),
        searching || this.expandedEntityIds.has(model.robot.id),
      ),
    );
    if (!searching && !this.expandedEntityIds.has(model.robot.id)) return rows;
    const visit = (parentId: string | undefined, depth: number): void => {
      for (const node of model.subsystems
        .filter((entry) => entry.parentId === parentId)
        .sort((left, right) => left.displayName.localeCompare(right.displayName))) {
        const devices = model.devices
          .filter((device) => device.parentId === node.id)
          .sort((left, right) => left.displayName.localeCompare(right.displayName));
        const children = model.subsystems.filter((entry) => entry.parentId === node.id);
        const commands = model.commands.filter((command) =>
          command.requirementIds.includes(node.id),
        );
        const hasChildren =
          devices.length > 0 ||
          children.length > 0 ||
          commands.length > 0 ||
          (node.stateMachine?.states.length ?? 0) > 0;
        if (query.length === 0 || node.displayName.toLowerCase().includes(query)) {
          rows.push(this.treeNode(node, depth, projectTreeIcon(node.kind), hasChildren));
        }
        if (!searching && hasChildren && !this.expandedEntityIds.has(node.id)) continue;
        visit(node.id, depth + 1);
        for (const device of devices) {
          if (query.length === 0 || device.displayName.toLowerCase().includes(query)) {
            rows.push(this.treeNode(device, depth + 1, projectTreeIcon(device.kind), false));
          }
        }
        for (const goal of node.stateMachine?.states ?? []) {
          if (query.length === 0 || goal.displayName.toLowerCase().includes(query)) {
            rows.push(this.treeLeaf(goal.displayName, 'goal', depth + 1, projectTreeIcon('goal')));
          }
        }
        for (const command of commands) {
          if (query.length === 0 || command.displayName.toLowerCase().includes(query)) {
            rows.push(
              this.treeLeaf(command.displayName, 'command', depth + 1, projectTreeIcon('command')),
            );
          }
        }
      }
    };
    visit(undefined, 1);
    for (const command of model.commands.filter((entry) => entry.requirementIds.length === 0)) {
      if (query.length === 0 || command.displayName.toLowerCase().includes(query)) {
        rows.push(this.treeLeaf(command.displayName, 'command', 1, projectTreeIcon('command')));
      }
    }
    return rows;
  }

  private treeRoot(id: string, label: string, icon: string, expanded: boolean): TemplateResult {
    return html`<button
      class="tree-node"
      role="treeitem"
      data-entity-id=${id}
      aria-expanded=${String(expanded)}
      @click=${() => this.toggleTreeNode(id)}
    >
      <md-icon>${expanded ? 'expand_more' : 'chevron_right'}</md-icon>
      <md-icon>${icon}</md-icon>
      <span class="tree-node-label">${label}</span>
      <span class="tree-badge">robot</span>
    </button>`;
  }

  private treeNode(
    node: Subsystem | Device,
    depth: number,
    icon: string,
    hasChildren: boolean,
  ): TemplateResult {
    const kind = 'parameters' in node ? node.kind : node.kind;
    const model = this.model();
    const imported = model !== undefined && this.isEntitySourceReadOnly(model, node);
    const expanded = hasChildren && this.expandedEntityIds.has(node.id);
    const implementation =
      'parameters' in node
        ? ''
        : node.realImplementation === true && node.simulationImplementation !== true
          ? ' · Real only'
          : '';
    return html`<div
      class="tree-node-wrap"
      style=${`padding-left:${String(7 + depth * 14)}px`}
      draggable=${String(!imported)}
      data-entity-id=${node.id}
      @dragstart=${() => (this.draggedEntityId = node.id)}
      @dragover=${(event: DragEvent) => this.allowTreeDrop(event, node.id)}
      @drop=${(event: DragEvent) => this.dropTreeNode(event, node.id)}
    >
      <button
        class="tree-node"
        role="treeitem"
        data-entity-id=${node.id}
        aria-expanded=${hasChildren ? String(expanded) : nothing}
        ?selected=${this.selectedEntityId === node.id}
        @click=${() => {
          this.selectedEntityId = node.id;
          if (hasChildren) this.toggleTreeNode(node.id);
        }}
        @contextmenu=${(event: Event) => this.openTreeMenu(event, node.id)}
      >
        <md-icon>${hasChildren ? (expanded ? 'expand_more' : 'chevron_right') : ''}</md-icon>
        <md-icon>${icon}</md-icon>
        <span class="tree-node-label">${node.displayName}</span>
        <span class="tree-badge"
          >${kind}${implementation}${imported ? ` · ${this.#i18n.t('structured.importedReadOnly')}` : ''}</span
        >
      </button>
      <md-icon-button
        aria-label="${this.#i18n.t('tree.more')}"
        @click=${(event: Event) => this.openTreeMenu(event, node.id)}
        ><md-icon>more_vert</md-icon></md-icon-button
      >
    </div>`;
  }

  private treeLeaf(label: string, kind: string, depth: number, icon: string): TemplateResult {
    return html`<button
      class="tree-node"
      role="treeitem"
      style=${`padding-left:${String(7 + depth * 14)}px`}
    >
      <md-icon></md-icon>
      <md-icon>${icon}</md-icon>
      <span class="tree-node-label">${label}</span>
      <span class="tree-badge">${kind}</span>
    </button>`;
  }

  private sourceTreeRows(query: string): readonly TemplateResult[] {
    const allFiles = this.project?.sourceFiles ?? [];
    const files =
      query.length === 0
        ? allFiles
        : allFiles.filter(
            (file) =>
              file.path.toLowerCase().includes(query) || file.format.toLowerCase().includes(query),
          );
    const directories = new Set<string>();
    for (const file of files) {
      const segments = file.path.split('/');
      for (let index = 1; index < segments.length; index += 1) {
        directories.add(segments.slice(0, index).join('/'));
      }
    }
    const rows: TemplateResult[] = [];
    const searching = query.length > 0;
    const visit = (parent: string, depth: number): void => {
      const prefix = parent.length === 0 ? '' : `${parent}/`;
      const childDirectories = [...directories]
        .filter((directory) => {
          if (!directory.startsWith(prefix)) return false;
          return !directory.slice(prefix.length).includes('/');
        })
        .sort((left, right) => left.localeCompare(right));
      for (const directory of childDirectories) {
        const expanded = searching || this.expandedSourcePaths.has(directory);
        const count = files.filter((file) => file.path.startsWith(`${directory}/`)).length;
        rows.push(
          html`<button
            class="tree-node"
            role="treeitem"
            style=${`padding-left:${String(7 + depth * 14)}px`}
            aria-expanded=${String(expanded)}
            @click=${() => this.toggleSourceDirectory(directory)}
          >
            <md-icon>${expanded ? 'expand_more' : 'chevron_right'}</md-icon>
            <md-icon>${expanded ? 'folder_open' : 'folder'}</md-icon>
            <span class="tree-node-label">${directory.split('/').at(-1)}</span>
            <span class="ownership">${String(count)}</span>
          </button>`,
        );
        if (expanded) visit(directory, depth + 1);
      }
      for (const file of files
        .filter((candidate) => {
          const slash = candidate.path.lastIndexOf('/');
          return (slash < 0 ? '' : candidate.path.slice(0, slash)) === parent;
        })
        .sort((left, right) => left.path.localeCompare(right.path))) {
        const label = file.path.split('/').at(-1) ?? file.path;
        rows.push(
          html`<button
            class="tree-node"
            role="treeitem"
            style=${`padding-left:${String(7 + depth * 14)}px`}
            ?selected=${this.selectedSourcePath === file.path}
            @click=${() => (this.selectedSourcePath = file.path)}
            @dblclick=${() => this.openSourceFile(file.path)}
          >
            <md-icon></md-icon>
            <md-icon>${this.sourceFileIcon(file)}</md-icon>
            <span class="tree-node-label">${label}</span>
            <span class="ownership"
              >${file.format}${file.externallyModified ? ` · ${this.#i18n.t('tree.modified')}` : ''}${file.problemCount > 0 ? ` · ${String(file.problemCount)} !` : ''}</span
            >
          </button>`,
        );
      }
    };
    visit('', 0);
    return rows;
  }

  private renderStructuredWorkspace(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const model = this.model();
    if (model === undefined) return html``;
    if (this.activePage === 'controls') return this.renderControlsWorkspace(model);
    if (this.activePage === 'commands') return this.renderCommandsWorkspace(model);
    if (this.activePage === 'presets') return this.renderPresetsWorkspace(model);
    if (this.activePage === 'tuning') return this.renderTuningWorkspace(model);
    if (this.activePage === 'calibration') return this.renderCalibrationWorkspace(model);
    if (this.activePage === 'toolchain') return this.renderToolchainWorkspace(model);
    if (this.activePage === 'problems') return this.renderProblemsWorkspace(model);
    if (this.activePage === 'docs') return this.renderDocsWorkspace();
    if (this.activePage === 'auto') return this.renderAutoWorkspace(model);
    const browseOnly = this.project?.sourceBrowseOnly === true;
    const roots = model.subsystems.filter((entry) => entry.parentId === undefined);
    return html`<section class="structured-workspace">
      <div class="workspace-heading">
        <div>
          <p class="eyebrow">${t('home.eyebrow')}</p>
          <h1>${t('structured.title')}</h1>
        </div>
        <div class="actions">
          <md-filled-button
            @click=${this.openSubsystemDialog}
            ?disabled=${browseOnly || this.project?.needsImportConfirmation === true}
            >${t('structured.addSubsystem')}</md-filled-button
          >
          <md-outlined-button
            @click=${this.openMechanismDialog}
            ?disabled=${browseOnly || this.selectedSubsystem() === undefined || this.selectedStructureReadOnly() || this.project?.needsImportConfirmation === true}
            >${t('structured.addMechanism')}</md-outlined-button
          >
          <md-outlined-button
            @click=${this.openDeviceDialog}
            ?disabled=${browseOnly || this.selectedSubsystem() === undefined || this.selectedStructureReadOnly() || this.project?.needsImportConfirmation === true}
            >${t('structured.addDevice')}</md-outlined-button
          >
          <md-outlined-button
            @click=${this.openGoalDialog}
            ?disabled=${browseOnly || this.selectedSubsystem()?.behaviorMode !== 'goal-driven' || this.selectedStructureReadOnly() || this.project?.needsImportConfirmation === true}
            >${t('structured.addGoal')}</md-outlined-button
          >
        </div>
      </div>
      <div class="path">${this.project?.path}</div>
      ${
        browseOnly
          ? html`<div class="workspace-card">
              <span class="muted">${t('structured.sourceBrowseOnly')}</span>
            </div>`
          : nothing
      }
      ${
        this.project?.needsImportConfirmation === true
          ? html`<div class="workspace-card">
              <div class="row">
                <strong>${t('structured.importSummary')}</strong>
                <md-filled-button @click=${this.confirmSourceImport}
                  >${t('structured.confirmImport')}</md-filled-button
                >
              </div>
              <span class="muted">
                ${this.project.sourceImport?.recognizedFiles ?? 0} ${t('structured.recognized')} ·
                ${this.project.sourceImport?.partialFiles ?? 0} ${t('structured.partial')} ·
                ${this.project.sourceImport?.customFiles ?? 0} ${t('structured.customFiles')}
              </span>
            </div>`
          : nothing
      }
      <div class="summary-grid">
        <div class="summary-card">
          <strong>${model.subsystems.length}</strong
          ><span class="muted">${t('structured.subsystem')}</span>
        </div>
        <div class="summary-card">
          <strong>${model.devices.length}</strong
          ><span class="muted">${t('structured.devices')}</span>
        </div>
        <div class="summary-card">
          <strong>${model.commands.length}</strong><span class="muted">${t('nav.commands')}</span>
        </div>
      </div>
      <div class="workspace-card">
        <strong>${this.#i18n.locale === 'zh-CN' ? '运行期遥测' : 'Runtime telemetry'}</strong>
        <label class="control-row">
          <md-switch
            aria-label=${t('structured.telemetryStateRecorder')}
            ?selected=${model.robot.telemetry?.stateRecorder !== false}
            @change=${(event: Event) => this.updateRobotTelemetry(model, 'stateRecorder', (event.target as HTMLElement & { selected: boolean }).selected)}
          ></md-switch>
          <span>RobotStateRecorder · AdvantageKit</span>
        </label>
        <label class="control-row">
          <md-switch
            aria-label=${t('structured.telemetryFieldPublisher')}
            ?selected=${model.robot.telemetry?.fieldPublisher !== false}
            @change=${(event: Event) => this.updateRobotTelemetry(model, 'fieldPublisher', (event.target as HTMLElement & { selected: boolean }).selected)}
          ></md-switch>
          <span>FieldPublisher · Field2d</span>
        </label>
      </div>
      <div class="hierarchy-list">
        ${
          roots.length === 0
            ? html`<div class="workspace-card">
                <span class="muted">${t('structured.noSubsystems')}</span>
              </div>`
            : roots.map(
                (root) =>
                  html`<button
                    class="hierarchy-row"
                    @click=${() => (this.selectedEntityId = root.id)}
                  >
                    <span>${root.displayName}</span>
                    <span class="tree-badge">${root.behaviorMode ?? 'direct'}</span>
                  </button>`,
              )
        }
      </div>
    </section>`;
  }

  private renderPresetsWorkspace(model: FrcProjectModel): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    return html`<section class="structured-workspace">
      <div class="workspace-heading">
        <div>
          <p class="eyebrow">${t('presets.available')}</p>
          <h1>${t('presets.title')}</h1>
        </div>
        <md-filled-button
          @click=${this.openPresetDialog}
          ?disabled=${this.project?.sourceBrowseOnly === true || this.project?.needsImportConfirmation === true}
          >${t('presets.add')}</md-filled-button
        >
      </div>
      <div class="summary-grid">
        ${PRESET_MANIFESTS.map(
          (manifest) =>
            html`<div class="summary-card">
              <strong>${manifest.displayName}</strong>
              <p>${this.localizedPresetText(manifest.summary)}</p>
              <span class="muted">v${manifest.version} · ${manifest.dependencies.join(' · ')}</span>
              <span class="muted"
                >${t('presets.includes')} · ${String(manifest.outputs.length)} files / entries</span
              >
            </div>`,
        )}
      </div>
      <h2>${t('presets.installed')}</h2>
      <div class="hierarchy-list">
        ${
          model.presets.length === 0
            ? html`<div class="workspace-card"><span class="muted">—</span></div>`
            : model.presets.map(
                (preset) =>
                  html`<div class="hierarchy-row">
                    <span>${preset.displayName}</span>
                    <span class="tree-badge"
                      >${preset.presetId} ·
                      v${preset.version}${
                        preset.customizedFiles.length === 0
                          ? ''
                          : ` · ${String(preset.customizedFiles.length)} customized`
                      }</span
                    >
                  </div>`,
              )
        }
      </div>
    </section>`;
  }

  private renderTuningWorkspace(model: FrcProjectModel): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const comparisons = this.tuningComparisons(model);
    const subsystems = [...new Set(comparisons.map((entry) => entry.subsystemName))].sort();
    const types = [...new Set(comparisons.map((entry) => entry.type))].sort();
    const query = this.ntSearch.trim().toLowerCase();
    const visible = comparisons.filter(
      (entry) =>
        (!this.ntOnlyDifferent || entry.state !== 'equal') &&
        (this.ntSubsystem.length === 0 || entry.subsystemName === this.ntSubsystem) &&
        (this.ntType.length === 0 || entry.type === this.ntType) &&
        (query.length === 0 ||
          `${entry.displayName} ${entry.path} ${entry.deviceName}`.toLowerCase().includes(query)),
    );
    const addresses = ntAddresses(model.project.teamNumber);
    return html`<section class="structured-workspace">
      <div class="workspace-heading">
        <div>
          <p class="eyebrow">NT4</p>
          <h1>${t('tuning.title')}</h1>
        </div>
        <div class="actions">
          <md-filled-button @click=${this.connectNt}>${t('tuning.connect')}</md-filled-button>
          <md-outlined-button @click=${this.disconnectNt}
            >${t('tuning.disconnect')}</md-outlined-button
          >
          <md-outlined-button @click=${() => this.launchExternal('advantagescope')}
            >${t('toolchain.openAdvantageScope')}</md-outlined-button
          >
        </div>
      </div>
      <div class="workspace-card">
        <div class="settings-grid">
          <md-outlined-select
            label=${t('tuning.address')}
            .value=${this.ntHost}
            @change=${(event: Event) => (this.ntHost = inputValue(event))}
          >
            ${addresses.map(
              (address) =>
                html`<md-select-option value=${address}
                  ><div slot="headline">${address}</div></md-select-option
                >`,
            )}
          </md-outlined-select>
          <div class="row">
            <md-icon
              >${this.ntSnapshot?.state === 'connected' ? 'cloud_done' : 'cloud_off'}</md-icon
            >
            <strong>${this.ntSnapshot?.state ?? 'idle'}</strong>
            <span class="muted">${this.ntSnapshot?.detail ?? ''}</span>
          </div>
        </div>
      </div>
      <div class="workspace-card">
        <div class="settings-grid">
          <md-outlined-text-field
            label=${t('tuning.search')}
            .value=${this.ntSearch}
            @input=${(event: Event) => (this.ntSearch = inputValue(event))}
          ></md-outlined-text-field>
          <label class="control-row"
            ><md-checkbox
              aria-label=${t('tuning.onlyDifferent')}
              ?checked=${this.ntOnlyDifferent}
              @change=${(event: Event) =>
                (this.ntOnlyDifferent = (event.target as HTMLInputElement).checked)}
            ></md-checkbox
            ><span>${t('tuning.onlyDifferent')}</span></label
          >
          <md-outlined-select
            label=${t('structured.subsystem')}
            .value=${this.ntSubsystem}
            @change=${(event: Event) => (this.ntSubsystem = inputValue(event))}
          >
            <md-select-option value=""
              ><div slot="headline">${t('tuning.all')}</div></md-select-option
            >
            ${subsystems.map((name) => html`<md-select-option value=${name}><div slot="headline">${name}</div></md-select-option>`)}
          </md-outlined-select>
          <md-outlined-select
            label=${t('tuning.type')}
            .value=${this.ntType}
            @change=${(event: Event) => (this.ntType = inputValue(event))}
          >
            <md-select-option value=""
              ><div slot="headline">${t('tuning.all')}</div></md-select-option
            >
            ${types.map((type) => html`<md-select-option value=${type}><div slot="headline">${type}</div></md-select-option>`)}
          </md-outlined-select>
        </div>
      </div>
      <div class="workspace-card" style="overflow:auto">
        <table class="tuning-table">
          <thead>
            <tr>
              <th></th>
              <th>${t('tuning.parameter')}</th>
              <th>${t('tuning.code')}</th>
              <th>${t('tuning.live')}</th>
              <th>${t('tuning.delta')}</th>
              <th>${t('tuning.path')}</th>
              <th>${t('tuning.status')}</th>
            </tr>
          </thead>
          <tbody>
            ${visible.map(
              (entry) =>
                html`<tr>
                  <td>
                    <md-checkbox
                      aria-label=${entry.displayName}
                      ?checked=${this.ntSelected.has(entry.parameterId)}
                      ?disabled=${!entry.selectable}
                      @change=${(event: Event) => this.selectTuning(entry, (event.target as HTMLInputElement).checked)}
                    ></md-checkbox>
                  </td>
                  <td>
                    <strong>${entry.displayName}</strong><br /><span class="muted"
                      >${entry.subsystemName} / ${entry.mechanismName}</span
                    >
                  </td>
                  <td>${formatValue(entry.codeValue)} ${entry.unit ?? ''}</td>
                  <td>
                    ${entry.liveValue === undefined ? '—' : formatValue(entry.liveValue)}
                    ${entry.unit ?? ''}
                  </td>
                  <td>${entry.delta === undefined ? '—' : formatValue(entry.delta)}</td>
                  <td><code>${entry.path}</code></td>
                  <td><span class="tree-badge">${entry.state}</span></td>
                </tr>`,
            )}
          </tbody>
        </table>
      </div>
      <div class="actions">
        <md-filled-button @click=${this.writeNtValuesToCode} ?disabled=${this.ntSelected.size === 0}
          >${t('tuning.write')}</md-filled-button
        >
        <span class="tree-badge">${t('tuning.validation')}: ${this.ntWriteValidation}</span>
      </div>
      <div class="workspace-card">
        <div class="row">
          <md-outlined-text-field
            label=${t('tuning.snapshotName')}
            .value=${this.ntSnapshotName}
            @input=${(event: Event) => (this.ntSnapshotName = inputValue(event))}
          ></md-outlined-text-field>
          <md-outlined-button
            @click=${this.saveTuningSnapshot}
            ?disabled=${this.ntSnapshotName.trim().length === 0}
            >${t('tuning.saveSnapshot')}</md-outlined-button
          >
        </div>
        <div class="hierarchy-list">
          ${model.tuningSnapshots.map((snapshot) => html`<div class="hierarchy-row"><span>${snapshot.name}</span><span class="tree-badge">${snapshot.capturedAt} · ${String(Object.keys(snapshot.values).length)} values</span></div>`)}
          ${model.tuningHistory
            .slice(-5)
            .reverse()
            .map(
              (entry) =>
                html`<div class="hierarchy-row">
                  <span>${entry.source} · ${entry.writtenAt}</span
                  ><span class="tree-badge">${String(entry.changes.length)} changes</span>
                </div>`,
            )}
        </div>
      </div>
    </section>`;
  }

  private renderCalibrationWorkspace(model: FrcProjectModel): TemplateResult {
    const zh = this.#i18n.locale === 'zh-CN';
    const motors = model.devices.filter((device) => device.kind === 'motor');
    const checks = [
      {
        devices: model.devices.filter((device) => device.role === 'swerve-encoder'),
        label: 'Swerve offset / direction',
      },
      {
        devices: model.devices.filter((device) => device.catalogId === 'ironpulse.pigeon2'),
        label: 'Pigeon mount orientation',
      },
      {
        devices: model.devices.filter((device) =>
          device.parameters.some((parameter) =>
            ['zeroingVoltage', 'forwardSoftLimit', 'reverseSoftLimit'].includes(parameter.key),
          ),
        ),
        label: 'Mechanism zero / home / limits',
      },
      {
        devices: model.devices.filter((device) => device.catalogId === 'frc.limelight'),
        label: 'Limelight robot-to-camera transform',
      },
    ];
    return html`<section class="structured-workspace">
      <div class="workspace-heading">
        <div>
          <p class="eyebrow">Safe bring-up</p>
          <h1>${zh ? '校准与设备检查' : 'Calibration & device checks'}</h1>
        </div>
        <md-outlined-button @click=${() => this.openSourceFile('docs/CALIBRATION.md')}
          >${zh ? '打开校准文档' : 'Open calibration docs'}</md-outlined-button
        >
      </div>
      <div class="summary-grid">
        ${checks.map(
          (check) =>
            html`<div class="summary-card">
              <strong>${check.label}</strong>
              <span class="muted"
                >${String(check.devices.length)} ${zh ? '个对象' : 'objects'}</span
              >
              ${check.devices.map(
                (device) =>
                  html`<md-text-button @click=${() => this.selectCalibrationEntity(device.id)}
                    >${device.displayName}</md-text-button
                  >`,
              )}
            </div>`,
        )}
      </div>
      <div class="workspace-card dialog-form">
        <strong>${zh ? '低功率方向测试' : 'Low-power direction test'}</strong>
        <span class="problem-text"
          >${zh ? '仅在 Driver Station Test Enabled 下执行；最大 15%，最长 2 秒，并自动停止。抬起机构并清空周围人员。' : 'Runs only while Driver Station is Test Enabled; maximum 15%, maximum 2 seconds, with automatic stop. Secure the mechanism and clear the area.'}</span
        >
        <div class="settings-grid">
          <md-outlined-text-field
            label=${this.#i18n.t('tuning.address')}
            .value=${this.ntHost}
            @input=${(event: Event) => (this.ntHost = inputValue(event))}
          ></md-outlined-text-field>
          <md-outlined-select
            label=${zh ? '电机' : 'Motor'}
            .value=${this.calibrationDeviceId}
            @change=${(event: Event) => (this.calibrationDeviceId = inputValue(event))}
          >
            ${motors.map((device) => html`<md-select-option value=${device.id}><div slot="headline">${device.displayName}</div></md-select-option>`)}
          </md-outlined-select>
          <md-outlined-text-field
            label=${zh ? '输出（-0.15 到 0.15）' : 'Output (-0.15 to 0.15)'}
            type="number"
            .value=${this.calibrationOutput}
            @input=${(event: Event) => (this.calibrationOutput = inputValue(event))}
          ></md-outlined-text-field>
          <md-outlined-text-field
            label=${zh ? '持续秒数' : 'Duration seconds'}
            type="number"
            .value=${this.calibrationDuration}
            @input=${(event: Event) => (this.calibrationDuration = inputValue(event))}
          ></md-outlined-text-field>
        </div>
        <label class="control-row"
          ><md-checkbox
            aria-label=${zh ? '确认校准测试安全条件' : 'Confirm calibration test safety conditions'}
            ?checked=${this.calibrationConfirmed}
            @change=${(event: Event) => (this.calibrationConfirmed = (event.target as HTMLInputElement).checked)}
          ></md-checkbox
          ><span
            >${zh ? '我已确认机器人处于安全 Test 模式且机构周围无人' : 'I confirm the robot is in a safe Test setup and the mechanism area is clear'}</span
          ></label
        >
        <div class="row">
          <md-outlined-button @click=${this.connectNt}
            >${this.#i18n.t('tuning.connect')}</md-outlined-button
          >
          <md-filled-button
            @click=${this.startCalibrationTest}
            ?disabled=${!this.calibrationConfirmed || this.calibrationDeviceId.length === 0}
            >${zh ? '开始短测' : 'Start short test'}</md-filled-button
          >
          <md-outlined-button @click=${this.stopCalibrationTest}
            >${zh ? '立即停止' : 'Stop now'}</md-outlined-button
          >
          <span class="tree-badge">NT ${this.ntSnapshot?.state ?? 'idle'}</span>
        </div>
      </div>
      <div class="workspace-card">
        <strong>SysId</strong>
        <p class="muted">
          ${zh ? 'MotorSubsystem 提供 quasistatic/dynamic 命令入口。WPILib DataLog 结果可用 AdvantageScope 打开；执行前仍需按机构单独完成安全审查。' : 'MotorSubsystem exposes quasistatic/dynamic command entry points. Open WPILib DataLog results in AdvantageScope and complete a mechanism-specific safety review first.'}
        </p>
        <div class="row">
          <md-outlined-button
            @click=${() => this.openSourceFile('src/main/java/lib/ironpulse/subsystem/MotorSubsystem.java')}
            >${zh ? '打开 SysId 代码入口' : 'Open SysId code entry'}</md-outlined-button
          ><md-outlined-button @click=${() => this.launchExternal('advantagescope')}
            >AdvantageScope</md-outlined-button
          >
        </div>
      </div>
    </section>`;
  }

  private renderToolchainWorkspace(model: FrcProjectModel): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const active = this.toolchainSnapshot?.active;
    const running = active?.state === 'running';
    return html`<section class="structured-workspace">
      <div class="workspace-heading">
        <div>
          <p class="eyebrow">WPILib ${model.project.wpilibYear}</p>
          <h1>${t('toolchain.title')}</h1>
        </div>
        <md-outlined-button @click=${this.refreshToolchainInfo}
          >${t('toolchain.refresh')}</md-outlined-button
        >
      </div>
      <div class="workspace-card">
        <strong>${this.toolchainInfo?.selected?.vendor ?? t('toolchain.notDetected')}</strong>
        <span class="muted">
          ${this.toolchainInfo?.selected?.version ?? ''} · Java
          ${this.toolchainInfo?.requiredMajor ?? 17}
        </span>
        <span class="path"
          >${this.toolchainInfo?.selected?.home ?? this.toolchainInfo?.selected?.executable ?? ''}</span
        >
      </div>
      <div class="actions">
        ${(['spotless', 'compile', 'test', 'simulate'] as const).map(
          (task) =>
            html`<md-filled-tonal-button
              @click=${() => this.startToolchainTask(task, false)}
              ?disabled=${running}
              >${t(`toolchain.${task}` as TranslationKey)}</md-filled-tonal-button
            >`,
        )}
        <md-filled-button @click=${this.openDeployDialog} ?disabled=${running}
          >${t('toolchain.deploy')}</md-filled-button
        >
        <md-outlined-button @click=${this.cancelToolchainTask} ?disabled=${!running}
          >${t('toolchain.cancel')}</md-outlined-button
        >
      </div>
      <div class="workspace-card">
        <div class="row">
          <strong>${active?.task ?? '—'}</strong>
          <span class="tree-badge">${active?.state ?? 'idle'}</span>
          <span class="muted"
            >${active?.durationMs === undefined ? '' : `${String(active.durationMs)} ms`}</span
          >
        </div>
        <pre class="task-output">${active?.output ?? t('toolchain.noOutput')}</pre>
      </div>
      <div class="hierarchy-list">
        ${(this.toolchainSnapshot?.recent ?? []).map(
          (run) =>
            html`<div class="hierarchy-row">
              <span>${run.task} · ${new Date(run.startedAt).toLocaleString()}</span>
              <span class="tree-badge">${run.state} · ${String(run.durationMs ?? 0)} ms</span>
            </div>`,
        )}
      </div>
    </section>`;
  }

  private renderProblemsWorkspace(model: FrcProjectModel): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const problems = this.workspaceProblems(model);
    return html`<section class="structured-workspace">
      <div class="workspace-heading">
        <h1>${t('problems.title')}</h1>
        <span class="tree-badge">${problems.length}</span>
        <md-outlined-button @click=${() => this.exportDiagnosticReport(problems)}
          >${this.#i18n.locale === 'zh-CN' ? '导出报告' : 'Export report'}</md-outlined-button
        >
      </div>
      <div class="hierarchy-list">
        ${
          problems.length === 0
            ? html`<div class="workspace-card">
                <md-icon>check_circle</md-icon> ${t('problems.none')}
              </div>`
            : problems.map(
                (problem) =>
                  html`<div
                    class="hierarchy-row"
                    role="button"
                    tabindex="0"
                    @click=${() => this.openWorkspaceProblem(problem)}
                  >
                    <span
                      ><strong>${problem.severity}</strong> · ${problem.message}<br /><span
                        class="muted"
                        >${problem.source} · ${problem.detail}</span
                      ></span
                    >
                    ${
                      problem.quickFix === undefined
                        ? nothing
                        : html`<md-outlined-button
                            @click=${(event: Event) => {
                              event.stopPropagation();
                              void this.previewCommand(problem.quickFix?.command as DomainCommand);
                            }}
                            >${problem.quickFix.label}</md-outlined-button
                          >`
                    }
                    <md-icon>${problem.severity === 'error' ? 'error' : 'warning'}</md-icon>
                  </div>`,
              )
        }
      </div>
    </section>`;
  }

  private renderDocsWorkspace(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const docs = (this.project?.sourceFiles ?? []).filter((entry) => entry.path.endsWith('.md'));
    return html`<section class="structured-workspace">
      <div class="workspace-heading"><h1>${t('docs.title')}</h1></div>
      <div class="hierarchy-list">
        ${docs.map(
          (doc) =>
            html`<button class="hierarchy-row" @click=${() => this.loadDocSupplement(doc.path)}>
              <span>${doc.path}</span><span class="tree-badge">${doc.ownership}</span>
            </button>`,
        )}
      </div>
      ${
        this.selectedDocPath === undefined
          ? nothing
          : html`<div class="workspace-card dialog-form">
              <div class="row">
                <strong>${this.selectedDocPath}</strong>
                <md-text-button @click=${() => this.openSourceFile(this.selectedDocPath ?? '')}
                  >${t('docs.openCode')}</md-text-button
                >
              </div>
              <md-outlined-text-field
                type="textarea"
                rows="14"
                label=${t('docs.supplement')}
                .value=${this.docSupplement}
                @input=${(event: Event) => (this.docSupplement = inputValue(event))}
              ></md-outlined-text-field>
              <md-filled-button @click=${this.saveDocSupplement}
                >${t('docs.save')}</md-filled-button
              >
            </div>`
      }
    </section>`;
  }

  private renderAutoWorkspace(model: FrcProjectModel): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    return html`<section class="structured-workspace">
      <div class="workspace-heading">
        <h1>${t('auto.title')}</h1>
        <div class="actions">
          <md-outlined-button @click=${() => this.launchExternal('pathplanner')}
            >${t('toolchain.openPathPlanner')}</md-outlined-button
          >
          <md-filled-button
            @click=${this.openAutoDialog}
            ?disabled=${this.project?.sourceBrowseOnly === true || model.commands.length === 0}
            >${t('auto.add')}</md-filled-button
          >
        </div>
      </div>
      <div class="workspace-card"><span class="muted">${t('auto.chooser')}</span></div>
      <div class="hierarchy-list">
        ${
          model.autos.length === 0
            ? html`<div class="workspace-card">${t('auto.none')}</div>`
            : model.autos.map((auto) => {
                const command = model.commands.find((entry) => entry.id === auto.commandId);
                const imported = this.isUnmanagedPath(model, command?.javaFile);
                return html`<div class="hierarchy-row">
                  <span
                    ><strong>${auto.displayName}</strong><br /><span class="muted"
                      >${command?.displayName ?? t('auto.missingCommand')}</span
                    ></span
                  >
                  <span class="row">
                    <span class="tree-badge">${auto.pathFiles.join(' · ') || 'Command'}</span>
                    ${auto.pathFiles[0] === undefined ? nothing : html`<md-icon-button aria-label=${t('auto.openPath')} @click=${() => this.openSourceFile(`src/main/deploy/${auto.pathFiles[0] ?? ''}`)}><md-icon>open_in_new</md-icon></md-icon-button>`}
                    ${
                      imported
                        ? html`<span class="ownership">${t('structured.importedReadOnly')}</span>
                            <md-icon-button
                              aria-label=${t('inspector.openCode')}
                              @click=${() => this.openSourceFile(command?.javaFile ?? '')}
                              ><md-icon>code</md-icon></md-icon-button
                            >`
                        : html`<md-icon-button
                            aria-label=${t('tree.delete')}
                            @click=${() => this.removeCollectionEntity('autos', auto.id)}
                            ><md-icon>delete</md-icon></md-icon-button
                          >`
                    }
                  </span>
                </div>`;
              })
        }
      </div>
    </section>`;
  }

  private renderControlsWorkspace(model: FrcProjectModel): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const browseOnly = this.project?.sourceBrowseOnly === true;
    return html`<section class="structured-workspace">
      <div class="workspace-heading">
        <h1>${t('controls.title')}</h1>
        <div class="actions">
          <md-filled-button @click=${this.openControllerDialog} ?disabled=${browseOnly}
            >${t('controls.addController')}</md-filled-button
          >
          <md-outlined-button
            @click=${this.openBindingDialog}
            ?disabled=${browseOnly || model.controllers.length === 0 || model.commands.length === 0}
            >${t('controls.addBinding')}</md-outlined-button
          >
        </div>
      </div>
      <div class="hierarchy-list">
        ${model.controllers.map((controller) => {
          const imported = model.bindings.some(
            (binding) =>
              binding.controllerId === controller.id && binding.codeReference !== undefined,
          );
          return html`<div class="hierarchy-row">
            <span
              >${controller.displayName}${typeof controller.parameters?.layout === 'string' && controller.parameters.layout.length > 0 ? html`<br /><span class="muted">${controller.parameters.layout}</span>` : nothing}</span
            >
            <span class="row">
              <span class="tree-badge">${controller.provider} · USB ${controller.port}</span>
              ${
                imported
                  ? html`<span class="ownership">${t('structured.importedReadOnly')}</span>`
                  : html`<md-icon-button
                      aria-label=${t('tree.delete')}
                      @click=${() => this.removeControllerEntity(controller.id)}
                      ><md-icon>delete</md-icon></md-icon-button
                    >`
              }
            </span>
          </div>`;
        })}
        ${model.bindings.map((binding) => {
          const controller = model.controllers.find((entry) => entry.id === binding.controllerId);
          const command = model.commands.find((entry) => entry.id === binding.commandId);
          return html`<div class="hierarchy-row">
            <span
              >${controller?.displayName ?? '?'} · ${binding.input}<br /><span class="muted"
                >${binding.behavior}${binding.timeoutSeconds === undefined ? '' : ` · ${String(binding.timeoutSeconds)} s`}
                ·
                ${command?.requirementIds.map((id) => model.subsystems.find((entry) => entry.id === id)?.displayName ?? '?').join(', ') || t('commands.noRequirements')}</span
              ></span
            >
            <span class="tree-badge"
              >${binding.behavior} → ${command?.displayName ?? 'custom'}</span
            >
            ${binding.behavior !== 'custom' ? nothing : html`<md-icon-button aria-label=${t('inspector.openCode')} @click=${() => this.openSourceFile(command?.javaFile ?? 'src/main/java')}><md-icon>code</md-icon></md-icon-button>`}
            ${
              binding.codeReference === undefined
                ? html`<md-icon-button
                    aria-label=${t('tree.delete')}
                    @click=${() => this.removeCollectionEntity('bindings', binding.id)}
                    ><md-icon>delete</md-icon></md-icon-button
                  >`
                : html`<span class="ownership">${t('structured.importedReadOnly')}</span>`
            }
          </div>`;
        })}
      </div>
    </section>`;
  }

  private renderCommandsWorkspace(model: FrcProjectModel): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    return html`<section class="structured-workspace">
      <div class="workspace-heading">
        <h1>${t('commands.title')}</h1>
        <md-filled-button
          @click=${this.openCommandDialog}
          ?disabled=${this.project?.sourceBrowseOnly === true}
          >${t('commands.add')}</md-filled-button
        >
      </div>
      <div class="hierarchy-list">
        ${model.commands.map((command) => {
          const imported = this.isUnmanagedPath(model, command.javaFile);
          const requirements = command.requirementIds
            .map((id) => model.subsystems.find((entry) => entry.id === id)?.displayName ?? '?')
            .join(', ');
          return html`<div class="hierarchy-row">
            <span
              ><strong>${command.displayName}</strong><br /><span class="muted"
                >${command.javaFile ?? 'RobotCommands.java'} ·
                ${requirements || t('commands.noRequirements')}</span
              ></span
            >
            <span class="row">
              <span class="tree-badge"
                >${command.kind} ·
                ${command.factory === false ? t('commands.instance') : t('commands.factory')}${command.pathplannerName === undefined ? '' : ` · PathPlanner: ${command.pathplannerName}`}</span
              >
              ${
                imported
                  ? html`<span class="ownership">${t('structured.importedReadOnly')}</span>
                      <md-icon-button
                        aria-label=${t('inspector.openCode')}
                        @click=${() => this.openSourceFile(command.javaFile ?? '')}
                        ><md-icon>code</md-icon></md-icon-button
                      >`
                  : html`<md-icon-button
                      aria-label=${t('tree.delete')}
                      @click=${() => this.removeCommand(command.id)}
                      ><md-icon>delete</md-icon></md-icon-button
                    >`
              }
            </span>
          </div>`;
        })}
      </div>
    </section>`;
  }

  private renderStructuredInspector(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const model = this.model();
    const selected = this.selectedEntity();
    if (this.treeMode === 'source' && this.selectedSourcePath !== undefined) {
      const source = this.project?.sourceFiles.find(
        (entry) => entry.path === this.selectedSourcePath,
      );
      return html`
        <section class="inspector-section">
          <span class="path">${this.selectedSourcePath}</span>
          ${
            source === undefined
              ? nothing
              : html`<div class="row">
                    <span class="tree-badge">${source.format}</span>
                    <span class="muted">${formatFileSize(source.size)}</span>
                  </div>
                  <div class="row">
                    <span class="ownership">${source.ownership}</span>
                    ${source.binary ? html`<span class="tree-badge">${t('tree.binary')}</span>` : nothing}
                  </div>`
          }
          <md-outlined-button @click=${() => this.openSourceFile(this.selectedSourcePath ?? '')}
            >${t('inspector.openCode')}</md-outlined-button
          >
          ${
            source?.binary !== true
              ? nothing
              : html`<span class="muted">${t('inspector.binaryFileHint')}</span>`
          }
        </section>
        ${
          (source?.symbols?.length ?? 0) === 0
            ? nothing
            : html`<section class="inspector-section">
                <span class="muted">${t('inspector.indexedSymbols')}</span>
                ${(source?.symbols ?? []).map(
                  (symbol) =>
                    html`<button
                      class="hierarchy-row"
                      @click=${() => this.openSourceFile(source?.path ?? '', symbol.line, symbol.column)}
                    >
                      <span>${symbol.label}</span
                      ><span class="tree-badge"
                        >${symbol.kind} · ${String(symbol.line)}:${String(symbol.column)}</span
                      >
                    </button>`,
                )}
              </section>`
        }
        ${
          source?.kind !== 'java'
            ? nothing
            : html`<section class="inspector-section">
                <span class="muted">${t('inspector.javaActions')}</span>
                <md-outlined-text-field
                  label=${t('inspector.importName')}
                  .value=${this.importName}
                  @input=${(event: Event) => (this.importName = inputValue(event))}
                ></md-outlined-text-field>
                <label class="control-row"
                  ><md-checkbox
                    aria-label=${t('inspector.staticImport')}
                    ?checked=${this.importStatic}
                    @change=${(event: Event) => (this.importStatic = (event.target as HTMLInputElement).checked)}
                  ></md-checkbox
                  ><span>${t('inspector.staticImport')}</span></label
                >
                <md-filled-button @click=${this.addJavaImport}
                  >${t('inspector.addImport')}</md-filled-button
                >
              </section>`
        }
      `;
    }
    if (model === undefined || selected === undefined) {
      return html`<section class="inspector-section">
        <span class="muted">${t('inspector.noEntity')}</span>
      </section>`;
    }
    if ('parameters' in selected) return this.renderDeviceInspector(selected);
    const referenceTargets = model.subsystems.filter(
      (entry) => entry.parentId === undefined && entry.id !== selected.id,
    );
    const runtimeFile = subsystemJavaLocation(model, selected).file;
    const imported = this.isEntitySourceReadOnly(model, selected);
    const hasGeneratedConfig =
      selected.symbol === 'SwerveSubsystem' ||
      model.devices.some(
        (device) =>
          device.parentId === selected.id &&
          device.kind === 'motor' &&
          !device.role?.startsWith('swerve-'),
      );
    const configFile =
      selected.symbol === 'SwerveSubsystem'
        ? runtimeFile.replace(/SwerveSubsystem\.java$/u, 'SwerveConfig.java')
        : runtimeFile.replace(/\.java$/u, 'Config.java');
    const automaticLocation = subsystemUsesAutomaticJavaLocation(model, selected);
    const parentOptions = this.subsystemParentOptions(selected);
    return html`
      <section class="inspector-section">
        <span class="muted">${selected.kind}</span>
        ${
          imported
            ? html`<span class="ownership">${t('structured.importedReadOnly')}</span>
                <span class="muted">${t('structured.importedReadOnlyHint')}</span>`
            : nothing
        }
        <md-outlined-text-field
          label=${t('structured.name')}
          .value=${selected.displayName}
          ?disabled=${imported}
          @change=${(event: Event) => this.renameSelected(inputValue(event), selected.symbol)}
        ></md-outlined-text-field>
        <md-outlined-text-field
          label=${t('structured.symbol')}
          .value=${selected.symbol}
          ?disabled=${imported}
          @change=${(event: Event) => this.renameSelected(selected.displayName, inputValue(event))}
        ></md-outlined-text-field>
        <strong>${t('structured.generatedLocation')}</strong>
        <span class="path">${runtimeFile}</span>
        <span class="muted"
          >${t(automaticLocation ? 'structured.locationAutomatic' : 'structured.locationFixed')}</span
        >
        <md-outlined-select
          label=${t('structured.parent')}
          .value=${selected.parentId ?? ''}
          ?disabled=${imported || !automaticLocation}
          @change=${(event: Event) =>
            this.moveSubsystemToParent(selected, inputValue(event) || undefined)}
        >
          <md-select-option value=""
            ><div slot="headline">${t('structured.projectRoot')}</div></md-select-option
          >
          ${parentOptions.map(
            (parent) =>
              html`<md-select-option value=${parent.id}
                ><div slot="headline">${this.presetParentLabel(parent)}</div></md-select-option
              >`,
          )}
        </md-outlined-select>
      </section>
      <section class="inspector-section">
        <span class="muted">${t('structured.behavior')}</span>
        <md-outlined-select
          .value=${selected.behaviorMode ?? 'direct'}
          ?disabled=${imported}
          @change=${(event: Event) => this.changeSubsystemBehavior(selected, inputValue(event) as NonNullable<Subsystem['behaviorMode']>)}
        >
          ${['direct', 'goal-driven', 'custom'].map((mode) => html`<md-select-option value=${mode}><div slot="headline">${mode}</div></md-select-option>`)}
        </md-outlined-select>
        ${
          selected.behaviorMode !== 'goal-driven'
            ? nothing
            : html`
                <label class="control-row"
                  ><md-switch
                    aria-label=${t('structured.goalCommand')}
                    ?selected=${selected.generateGoalCommand !== false}
                    ?disabled=${imported}
                    @change=${(event: Event) => this.updateSubsystemScaffold(selected, { generateGoalCommand: (event.target as HTMLElement & { selected: boolean }).selected })}
                  ></md-switch
                  ><span>${t('structured.goalCommand')}</span></label
                >
                <label class="control-row"
                  ><md-switch
                    aria-label=${t('structured.goalLogging')}
                    ?selected=${selected.advantageKitLogging === true}
                    ?disabled=${imported}
                    @change=${(event: Event) => this.updateSubsystemScaffold(selected, { advantageKitLogging: (event.target as HTMLElement & { selected: boolean }).selected })}
                  ></md-switch
                  ><span>${t('structured.goalLogging')}</span></label
                >
                <div class="hierarchy-list">
                  ${(selected.stateMachine?.states ?? []).map(
                    (goal) =>
                      html`<div class="hierarchy-row">
                        <span
                          ><strong>${goal.displayName}</strong><br /><span class="muted"
                            >${goal.symbol}${goal.initial === true ? ' · initial' : ''}</span
                          ></span
                        >
                        <md-icon-button
                          aria-label=${`${t('tree.delete')} ${goal.displayName}`}
                          ?disabled=${imported}
                          @click=${() => this.removeGoal(selected, goal.id)}
                          ><md-icon>delete</md-icon></md-icon-button
                        >
                      </div>`,
                  )}
                </div>
              `
        }
        <div class="row">
          <md-outlined-button @click=${() => this.openSourceFile(runtimeFile)}
            >${t('inspector.openCode')}</md-outlined-button
          >
          ${hasGeneratedConfig ? html`<md-outlined-button @click=${() => this.openSourceFile(configFile)}>${t('inspector.openConfig')}</md-outlined-button>` : nothing}
        </div>
      </section>
      <section class="inspector-section">
        <span class="muted">${t('inspector.references')}</span>
        ${(selected.dependencies ?? []).map((dependency) => {
          const target = model.subsystems.find(
            (entry) => entry.id === dependency.targetSubsystemId,
          );
          return html`<div class="hierarchy-row">
            <span
              >${dependency.fieldName}: ${target?.displayName ?? dependency.targetSubsystemId}</span
            >
            <md-icon-button
              aria-label=${`${t('tree.delete')} ${dependency.fieldName}`}
              ?disabled=${imported}
              @click=${() => this.removeSubsystemReference(selected, dependency.targetSubsystemId)}
              ><md-icon>delete</md-icon></md-icon-button
            >
          </div>`;
        })}
        ${
          referenceTargets.length === 0
            ? nothing
            : html`<md-outlined-select
                label=${t('inspector.addReference')}
                ?disabled=${imported}
                @change=${(event: Event) => this.prepareSubsystemReference(selected, inputValue(event))}
              >
                ${referenceTargets.map((target) => html`<md-select-option value=${target.id}><div slot="headline">${target.displayName}</div></md-select-option>`)}
              </md-outlined-select>`
        }
      </section>
    `;
  }

  private renderDeviceInspector(device: Device): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const model = this.model();
    const imported = model !== undefined && this.isEntitySourceReadOnly(model, device);
    const definition =
      device.catalogId === undefined ? undefined : findComponentDefinition(device.catalogId);
    const owner = model?.subsystems.find((entry) => entry.id === device.parentId);
    const existingKeys = new Set(device.parameters.map((parameter) => parameter.key));
    const optional =
      definition?.parameters.filter((parameter) => !existingKeys.has(parameter.key)) ?? [];
    return html`
      <section class="inspector-section">
        <span class="muted">${t('inspector.catalogType')}</span>
        ${
          imported
            ? html`<span class="ownership">${t('structured.importedReadOnly')}</span>
                <span class="muted">${t('structured.importedReadOnlyHint')}</span>`
            : nothing
        }
        <strong>${definition?.displayName ?? `${device.vendor} ${device.model}`}</strong>
        ${definition === undefined ? nothing : html`<span class="muted">${definition.description}</span>`}
        ${definition === undefined ? nothing : html`<span class="path">Real: ${definition.realClass}<br />Sim: ${definition.simClass}</span>`}
        ${definition === undefined ? nothing : html`<md-outlined-button @click=${() => this.openSourceFile(definition.documentationUrl.split('#')[0] ?? definition.documentationUrl)}>${t('inspector.componentDocs')}</md-outlined-button>`}
        <span class="path">CAN ${device.canId ?? '—'} · ${device.canBus ?? 'rio'}</span>
        <md-outlined-select
          label=${t('structured.parent')}
          .value=${owner?.id ?? ''}
          ?disabled=${imported || model === undefined}
          @change=${(event: Event) => this.moveDeviceToParent(device, inputValue(event))}
        >
          ${(model === undefined ? [] : this.editableSubsystems()).map(
            (parent) =>
              html`<md-select-option value=${parent.id}
                ><div slot="headline">${this.presetParentLabel(parent)}</div></md-select-option
              >`,
          )}
        </md-outlined-select>
      </section>
      <section class="inspector-section">
        <span class="muted">${t('inspector.parameters')}</span>
        <div class="parameter-list">
          ${device.parameters.map((parameter) => {
            const catalogParameter = definition?.parameters.find(
              (entry) => entry.key === parameter.key,
            );
            const ntEnabled = parameter.networkTables?.enabled !== false;
            return keyed(
              `${parameter.id}:${JSON.stringify(parameter.value)}`,
              html`
                <div class="parameter-row" data-field=${`parameters.${parameter.key}`}>
                  <span class="parameter-copy">
                    <strong>${parameter.displayName}</strong>
                    <span class="muted">${parameter.unit ?? parameter.type}</span>
                    <span class="muted parameter-description"
                      >${this.parameterDescription(parameter, catalogParameter)}</span
                    >
                  </span>
                  <div class="parameter-control-row">
                    ${
                      parameter.type === 'boolean'
                        ? html`<md-switch
                            aria-label=${parameter.displayName}
                            ?selected=${parameter.value === true}
                            ?disabled=${imported}
                            @change=${(event: Event) => this.updateParameter(device, parameter.key, (event.target as HTMLElement & { selected: boolean }).selected)}
                          ></md-switch>`
                        : parameter.type === 'enum'
                          ? html`<md-outlined-select
                              aria-label=${parameter.displayName}
                              .value=${String(parameter.value)}
                              ?disabled=${imported}
                              @change=${(event: Event) => this.updateParameter(device, parameter.key, inputValue(event))}
                            >
                              ${(parameter.enumValues ?? []).map(
                                (value) =>
                                  html`<md-select-option value=${value}
                                    ><div slot="headline">${value}</div></md-select-option
                                  >`,
                              )}
                            </md-outlined-select>`
                          : html`<md-outlined-text-field
                              aria-label=${parameter.displayName}
                              .value=${this.parameterText(parameter.value)}
                              ?disabled=${imported}
                              placeholder=${parameter.key === 'setpoints' ? 'HOME=0, SPEAKER=85' : ''}
                              @change=${(event: Event) => this.updateParameter(device, parameter.key, this.parseParameterValue(parameter.type, inputValue(event)))}
                            ></md-outlined-text-field>`
                    }
                    <md-filter-chip
                      label=${t('inspector.ntChipLabel')}
                      ?selected=${ntEnabled}
                      ?disabled=${imported}
                      aria-label=${ntEnabled ? t('inspector.ntEnabled') : t('inspector.ntDisabled')}
                      @click=${() => this.toggleParameterNt(device, parameter.key)}
                    ></md-filter-chip>
                    ${
                      catalogParameter?.required === true
                        ? nothing
                        : html`<md-icon-button
                            aria-label=${`${t('tree.delete')} ${parameter.displayName}`}
                            ?disabled=${imported}
                            @click=${() => this.removeOptionalParameter(device, parameter.key)}
                            ><md-icon>delete</md-icon></md-icon-button
                          >`
                    }
                  </div>
                  <span class="muted parameter-nt-state">
                    <md-icon>${ntEnabled ? 'tune' : 'sync_disabled'}</md-icon>
                    ${ntEnabled ? t('inspector.ntEnabled') : t('inspector.ntDisabled')}
                  </span>
                </div>
              `,
            );
          })}
        </div>
        ${
          optional.length === 0
            ? nothing
            : html`<md-outlined-select
                label=${t('inspector.addParameter')}
                ?disabled=${imported}
                @change=${(event: Event) => this.addOptionalParameter(device, inputValue(event))}
              >
                ${optional.map((parameter) => html`<md-select-option value=${parameter.key}><div slot="headline">${parameter.displayName}</div></md-select-option>`)}
              </md-outlined-select>`
        }
      </section>
    `;
  }

  private renderDiffPreview(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const preview = this.preview;
    if (preview === undefined) return html``;
    const changes = preview.changes.filter(
      (change) =>
        change.kind !== 'unchanged' &&
        change.path.toLowerCase().includes(this.diffFilter.trim().toLowerCase()),
    );
    return html`<div class="diff-content">
      <div class="row">
        <strong>${t('diff.pending')}</strong><span>${changes.length} ${t('diff.files')}</span>
      </div>
      ${preview.problems.map((problem) => html`<span class="problem-text">${problem}</span>`)}
      ${preview.safeToApply ? html`<span class="muted">${t('diff.safe')}</span>` : nothing}
      <md-outlined-text-field
        label=${t('diff.filter')}
        .value=${this.diffFilter}
        @input=${(event: Event) => (this.diffFilter = inputValue(event))}
      ></md-outlined-text-field>
      <div class="diff-list">
        ${changes.map(
          (change) =>
            html`<div class="diff-row">
              <code>${change.path}</code><span class="tree-badge">${change.kind}</span>
              <div class="line-diff">
                ${change.lines
                  .filter((line) => line.kind !== 'context')
                  .slice(0, 20)
                  .map(
                    (line) =>
                      html`<span class=${line.kind === 'added' ? 'line-added' : 'line-removed'}
                        >${line.kind === 'added' ? '+' : '-'} ${line.text}</span
                      >`,
                  )}
              </div>
            </div>`,
        )}
      </div>
      <div class="preview-actions">
        <md-filled-button @click=${this.applyPreview} ?disabled=${preview.problems.length > 0}
          >${t('diff.apply')}</md-filled-button
        >
        <md-text-button @click=${this.discardPreview}>${t('diff.discard')}</md-text-button>
      </div>
    </div>`;
  }

  override disconnectedCallback(): void {
    window.removeEventListener('keydown', this.#keyHandler);
    window.removeEventListener('resize', this.#windowResizeHandler);
    this.#removeProjectListener?.();
    this.#removeFilesChangedListener?.();
    if (this.#ntTimer !== undefined) clearInterval(this.#ntTimer);
    if (this.#toolchainTimer !== undefined) clearInterval(this.#toolchainTimer);
    if (this.#sourceSyncTimer !== undefined) clearTimeout(this.#sourceSyncTimer);
    super.disconnectedCallback();
  }

  override render(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const layoutStyle = `--left-width:${String(this.layout.leftPanelWidth)}px;--inspector-width:${String(this.layout.inspectorWidth)}px;--bottom-height:${String(this.layout.bottomPanelHeight)}px`;
    return html`
      <div
        class="shell"
        style=${layoutStyle}
        @dragover=${(event: DragEvent) => event.preventDefault()}
        @drop=${this.onDrop}
      >
        <header class="top-bar">
          <div class="brand" aria-label=${t('app.name')}>
            <span class="mark" aria-hidden="true"><img src=${frameworkLogo} alt="" /></span>
            <span class="brand-copy">
              <strong>${t('app.name')}</strong>
              <span>${this.project?.displayName ?? t('app.noProject')}</span>
            </span>
          </div>
          ${this.working ? html`<md-linear-progress indeterminate></md-linear-progress>` : nothing}
          <md-icon-button aria-label=${t('commandPalette.label')} @click=${this.openCommandPalette}>
            <md-icon>search</md-icon>
          </md-icon-button>
          <md-outlined-button @click=${this.openAbout}>${t('app.about')}</md-outlined-button>
          <md-filled-button @click=${this.chooseDirectory} ?disabled=${this.working}>
            ${this.working ? t('app.opening') : t('app.openFolder')}
          </md-filled-button>
        </header>

        <nav aria-label=${t('nav.workspace')}>
          <md-list>
            ${navigation.map(
              ([id, key], index) => html`
                <md-list-item
                  type="button"
                  aria-label=${t(key)}
                  aria-current=${this.activePage === id ? 'page' : 'false'}
                  @click=${() => (this.activePage = id)}
                >
                  <span slot="start" class="nav-index">${String(index + 1).padStart(2, '0')}</span>
                  <span slot="headline">${t(key)}</span>
                </md-list-item>
              `,
            )}
          </md-list>
          ${this.project?.model === undefined ? nothing : this.renderProjectTree()}
          <div class="nav-bottom">
            <md-divider></md-divider>
            <md-list>
              <md-list-item
                type="button"
                aria-label=${t('nav.settings')}
                @click=${this.openSettings}
              >
                <md-icon slot="start">settings</md-icon>
                <span slot="headline">${t('nav.settings')}</span>
              </md-list-item>
            </md-list>
          </div>
        </nav>

        <main>
          ${
            this.project?.model === undefined
              ? html` <p class="eyebrow">${t('home.eyebrow')}</p>
                  <h1>${t('home.titleA')}<br />${t('home.titleB')}</h1>
                  <p class="lead">${t('home.lead')}</p>
                  <div class="actions">
                    <md-filled-button @click=${this.chooseDirectory} ?disabled=${this.working}>
                      ${t('home.choose')}
                    </md-filled-button>
                    <md-outlined-button @click=${this.openCreateDialog}
                      >${t('home.create')}</md-outlined-button
                    >
                    <md-text-button @click=${this.chooseDirectory}
                      >${t('home.import')}</md-text-button
                    >
                  </div>

                  ${this.renderMigrationCard()}

                  <section class="workspace-card" aria-labelledby="workspace-preview-heading">
                    <header>
                      <div>
                        <h2 id="workspace-preview-heading">${t('workspace.title')}</h2>
                        <span class="muted">${t('workspace.subtitle')}</span>
                      </div>
                      <md-icon-button aria-label=${t('workspace.actions')}>
                        <md-icon>more_horiz</md-icon>
                      </md-icon-button>
                    </header>
                    <div class="path" title=${this.directorySelection?.path ?? ''}>
                      ${this.directorySelection?.path ?? t('workspace.folderMissing')}
                    </div>
                    <div class="component-preview">
                      <div class="field-stack">
                        <md-outlined-text-field
                          label=${t('workspace.name')}
                          value=${this.createName}
                        >
                        </md-outlined-text-field>
                        <md-outlined-select label=${t('workspace.type')} value="java">
                          <md-select-option value="java" selected>
                            <div slot="headline">${t('workspace.typeJava')}</div>
                          </md-select-option>
                          <md-select-option value="import">
                            <div slot="headline">${t('workspace.typeImport')}</div>
                          </md-select-option>
                        </md-outlined-select>
                      </div>
                      <div class="field-stack">
                        <label class="control-row">
                          <md-checkbox aria-label=${t('workspace.docs')} checked></md-checkbox
                          ><span>${t('workspace.docs')}</span>
                        </label>
                        <label class="control-row">
                          <md-switch
                            aria-label=${t('workspace.preview')}
                            ?selected=${this.settings.previewChanges}
                            @change=${this.togglePreviewChanges}
                          ></md-switch>
                          <span>${t('workspace.preview')}</span>
                        </label>
                      </div>
                    </div>
                  </section>

                  <section class="recent-card" aria-labelledby="recent-heading">
                    <header><h2 id="recent-heading">${t('recent.title')}</h2></header>
                    ${this.renderRecentProjects()}
                  </section>`
              : this.renderStructuredWorkspace()
          }
        </main>

        <aside aria-label=${t('inspector.title')}>
          <h2>${t('inspector.title')}</h2>
          ${
            this.project?.model === undefined
              ? html` <section class="inspector-section">
                    <span class="muted">${t('inspector.selection')}</span>
                    <strong>${this.selectionLabel()}</strong>
                  </section>
                  <section class="inspector-section">
                    <span class="muted">${t('inspector.policy')}</span>
                    <label class="control-row">
                      <md-checkbox
                        aria-label=${t('inspector.showDiff')}
                        ?checked=${this.settings.previewChanges}
                      ></md-checkbox>
                      <span>${t('inspector.showDiff')}</span>
                    </label>
                    <label class="control-row">
                      <md-switch
                        aria-label=${t('inspector.readOnly')}
                        ?selected=${this.project?.readOnly ?? false}
                      ></md-switch>
                      <span>${t('inspector.readOnly')}</span>
                    </label>
                  </section>
                  <section class="inspector-section">
                    <span class="muted">${t('inspector.directoryEntries')}</span>
                    <strong>${this.directorySelection?.entryCount ?? '—'}</strong>
                  </section>`
              : this.renderStructuredInspector()
          }
        </aside>

        <section class="bottom-panel" aria-label=${t('bottom.status')}>
          <md-tabs aria-label=${t('bottom.panels')}>
            <md-primary-tab active>${t('bottom.problems')}</md-primary-tab>
            <md-primary-tab>${t('bottom.diff')}</md-primary-tab>
            <md-primary-tab>${t('bottom.build')}</md-primary-tab>
          </md-tabs>
          <div class="status-content" aria-live="polite">
            <span class="status-dot ${this.noticeError ? 'error' : ''}"></span>
            ${this.notice || t('bottom.ready')}
          </div>
          ${this.preview === undefined ? nothing : this.renderDiffPreview()}
        </section>

        <div
          class="resize-handle resize-left"
          role="separator"
          tabindex="0"
          aria-label=${t('layout.resizeNavigation')}
          aria-orientation="vertical"
          aria-valuemin=${String(PANEL_LAYOUT.leftMinimum)}
          aria-valuemax=${String(PANEL_LAYOUT.leftMaximum)}
          aria-valuenow=${String(this.layout.leftPanelWidth)}
          @pointerdown=${(event: PointerEvent) => this.startResize('left', event)}
        ></div>
        <div
          class="resize-handle resize-inspector"
          role="separator"
          tabindex="0"
          aria-label=${t('layout.resizeInspector')}
          aria-orientation="vertical"
          aria-valuemin=${String(PANEL_LAYOUT.inspectorMinimum)}
          aria-valuemax=${String(PANEL_LAYOUT.inspectorMaximum)}
          aria-valuenow=${String(this.layout.inspectorWidth)}
          @pointerdown=${(event: PointerEvent) => this.startResize('inspector', event)}
        ></div>
        <div
          class="resize-handle resize-bottom"
          role="separator"
          tabindex="0"
          aria-label=${t('layout.resizeOutput')}
          aria-orientation="horizontal"
          aria-valuemin="96"
          aria-valuemax="420"
          aria-valuenow=${String(this.layout.bottomPanelHeight)}
          @pointerdown=${(event: PointerEvent) => this.startResize('bottom', event)}
        ></div>
      </div>

      ${this.renderCreateDialog()} ${this.renderSettingsDialog()} ${this.renderCommandPalette()}
      ${this.renderHelpDialog()} ${this.renderSubsystemDialog()} ${this.renderMechanismDialog()}
      ${this.renderDeviceDialog()} ${this.renderGoalDialog()} ${this.renderControllerDialog()}
      ${this.renderCommandDialog()} ${this.renderBindingDialog()} ${this.renderAutoDialog()}
      ${this.renderPresetDialog()} ${this.renderDeployDialog()} ${this.renderDeleteImpactDialog()}
      ${this.renderReferenceImpactDialog()} ${this.renderExternalChangeDialog()}
      <md-dialog id="about-dialog">
        <div slot="headline">${t('app.name')}</div>
        <div slot="content" class="dialog-form">
          <p>${t('app.tagline')}</p>
          <div class="summary-grid">
            <span>${t('app.version')}</span><strong>${this.appInfo?.version ?? '—'}</strong>
            <span>${t('app.developer')}</span><strong>0.2Studio</strong>
            <span>${t('app.acknowledgements')}</span><strong>IronPulse 6941</strong>
            <span>${t('app.schemaVersion')}</span
            ><strong>${this.appInfo?.release.schemaVersion ?? '—'}</strong>
            <span>${t('app.baseVersion')}</span
            ><strong>${this.appInfo?.release.baseVersion ?? '—'}</strong>
            <span>${t('app.presetApiVersion')}</span
            ><strong>${this.appInfo?.release.presetApiVersion ?? '—'}</strong>
            <span>${t('app.supportedWpilibYears')}</span
            ><strong>${this.appInfo?.release.supportedWpilibYears.join(', ') ?? '—'}</strong>
          </div>
          <p class="muted">
            ${
              this.appInfo?.release.presets
                .map((preset) => `${preset.id} v${String(preset.version)}`)
                .join(' · ') ?? ''
            }
          </p>
          ${
            this.updateCheck === undefined
              ? nothing
              : html`<p role="status">
                  ${
                    !this.updateCheck.releasePublished
                      ? t('app.noReleases')
                      : this.updateCheck.updateAvailable
                        ? `${t('app.updateAvailable')} v${this.updateCheck.latestVersion ?? ''}`
                        : t('app.upToDate')
                  }
                </p>`
          }
          <md-outlined-button @click=${this.checkForUpdates}
            >${t('app.checkUpdates')}</md-outlined-button
          >
        </div>
        <div slot="actions">
          <md-filled-button @click=${this.closeAbout}>${t('app.done')}</md-filled-button>
        </div>
      </md-dialog>
    `;
  }

  private renderRecentProjects(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    if (this.recentProjects.length === 0) {
      return html`<span class="muted">${t('recent.empty')}</span>`;
    }
    return html`<md-list>
      ${this.recentProjects.map(
        (project) => html`
          <md-list-item
            type="button"
            aria-disabled=${String(!project.available)}
            @click=${() => this.openRecent(project)}
          >
            <span slot="headline" class=${project.available ? '' : 'unavailable'}>
              ${project.displayName}${project.available ? '' : ` · ${t('recent.invalid')}`}
            </span>
            <span slot="supporting-text" class="recent-path">${project.path}</span>
            ${
              !project.available
                ? html`<md-text-button
                    slot="end"
                    @click=${(event: Event) => this.relinkRecent(event, project)}
                    >${t('recent.relink')}</md-text-button
                  >`
                : nothing
            }
            <md-icon-button
              slot="end"
              aria-label=${t('recent.remove')}
              @click=${(event: Event) => this.removeRecent(event, project)}
            >
              <md-icon>close</md-icon>
            </md-icon-button>
          </md-list-item>
        `,
      )}
    </md-list>`;
  }

  private renderMigrationCard(): TemplateResult | typeof nothing {
    const migration = this.project?.migration;
    if (migration === undefined) return nothing;
    const t = (key: TranslationKey) => this.#i18n.t(key);
    return html`<section class="workspace-card">
      <div class="row">
        <div>
          <h2>${t('migration.title')}</h2>
          <span class="muted"
            >${String(migration.fromVersion)} → ${String(migration.toVersion)}</span
          >
        </div>
        <md-filled-button
          @click=${this.migrateProject}
          ?disabled=${!migration.supported || this.project?.readOnly === true}
          >${t('migration.apply')}</md-filled-button
        >
      </div>
      ${migration.summary.map((entry) => html`<span>${entry}</span>`)}
      <span class="muted">${t('migration.backup')}</span>
    </section>`;
  }

  private renderCreateDialog(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    return html`<md-dialog id="create-dialog">
      <div slot="headline">${t('create.title')}</div>
      <div slot="content" class="dialog-form">
        <span class="muted">${t('create.validation')}</span>
        <md-outlined-text-field
          label=${t('create.name')}
          .value=${this.createName}
          @input=${(event: Event) => (this.createName = inputValue(event))}
        ></md-outlined-text-field>
        <md-outlined-text-field
          label=${t('create.team')}
          type="number"
          .value=${this.createTeam}
          @input=${(event: Event) => (this.createTeam = inputValue(event))}
        ></md-outlined-text-field>
        <md-outlined-text-field
          label=${t('create.javaPackage')}
          .value=${this.createPackage}
          @input=${(event: Event) => (this.createPackage = inputValue(event))}
        ></md-outlined-text-field>
        <md-outlined-select
          label=${t('create.wpilibYear')}
          .value=${this.createYear}
          @change=${(event: Event) => (this.createYear = inputValue(event))}
        >
          <md-select-option value="2026"><div slot="headline">2026</div></md-select-option>
        </md-outlined-select>
        ${this.working ? html`<md-linear-progress indeterminate></md-linear-progress>` : nothing}
      </div>
      <div slot="actions">
        <md-text-button @click=${() => this.dialog('create-dialog')?.close()}>
          ${t('create.cancel')}
        </md-text-button>
        <md-filled-button @click=${() => void this.createProject()} ?disabled=${this.working}>
          ${this.working ? t('create.creating') : t('create.continue')}
        </md-filled-button>
      </div>
    </md-dialog>`;
  }

  private renderSubsystemDialog(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const parentOptions = this.editableSubsystems();
    const location = this.prospectiveSubsystemLocation(
      this.subsystemName,
      this.subsystemParentId,
      this.subsystemKind,
    );
    return html`<md-dialog id="subsystem-dialog">
      <div slot="headline">${t('structured.addSubsystem')}</div>
      <div slot="content" class="dialog-form">
        <md-outlined-text-field
          label=${t('structured.subsystemName')}
          .value=${this.subsystemName}
          @input=${(event: Event) => (this.subsystemName = inputValue(event))}
        ></md-outlined-text-field>
        <md-outlined-select
          label=${t('structured.parent')}
          .value=${this.subsystemParentId}
          @change=${(event: Event) => (this.subsystemParentId = inputValue(event))}
        >
          <md-select-option value=""
            ><div slot="headline">${t('structured.projectRoot')}</div></md-select-option
          >
          ${parentOptions.map(
            (subsystem) =>
              html`<md-select-option value=${subsystem.id}
                ><div slot="headline">${this.presetParentLabel(subsystem)}</div></md-select-option
              >`,
          )}
        </md-outlined-select>
        <div class="settings-grid">
          <md-outlined-select
            label=${t('structured.kind')}
            .value=${this.subsystemKind}
            @change=${(event: Event) => (this.subsystemKind = inputValue(event) as Subsystem['kind'])}
          >
            <md-select-option value="subsystem"
              ><div slot="headline">${t('structured.subsystem')}</div></md-select-option
            >
            <md-select-option value="group"
              ><div slot="headline">${t('structured.superstructure')}</div></md-select-option
            >
          </md-outlined-select>
          <md-outlined-select
            label=${t('structured.behavior')}
            .value=${this.subsystemBehavior}
            @change=${(event: Event) => (this.subsystemBehavior = inputValue(event) as NonNullable<Subsystem['behaviorMode']>)}
          >
            <md-select-option value="direct"
              ><div slot="headline">${t('structured.direct')}</div></md-select-option
            >
            <md-select-option value="goal-driven"
              ><div slot="headline">${t('structured.goalDriven')}</div></md-select-option
            >
            <md-select-option value="custom"
              ><div slot="headline">${t('structured.custom')}</div></md-select-option
            >
          </md-outlined-select>
        </div>
        <div class="workspace-card">
          <strong>${t('structured.generatedLocation')}</strong>
          <span class="path">${location}</span>
          <span class="muted">${t('structured.locationAutomatic')}</span>
        </div>
        <label class="control-row"
          ><md-checkbox
            aria-label=${t('structured.real')}
            ?checked=${this.subsystemReal}
            @change=${(event: Event) => (this.subsystemReal = (event.target as HTMLInputElement).checked)}
          ></md-checkbox
          ><span>${t('structured.real')}</span></label
        >
        <label class="control-row"
          ><md-checkbox
            aria-label=${t('structured.sim')}
            ?checked=${this.subsystemSim}
            @change=${(event: Event) => (this.subsystemSim = (event.target as HTMLInputElement).checked)}
          ></md-checkbox
          ><span>${t('structured.sim')}</span></label
        >
      </div>
      <div slot="actions">
        <md-text-button @click=${() => this.dialog('subsystem-dialog')?.close()}
          >${t('create.cancel')}</md-text-button
        >
        <md-filled-button @click=${() => void this.addSubsystem()}
          >${t('structured.addSubsystem')}</md-filled-button
        >
      </div>
    </md-dialog>`;
  }

  private renderMechanismDialog(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const parentOptions = this.editableSubsystems();
    const location = this.prospectiveSubsystemLocation(
      this.mechanismName,
      this.mechanismParentId,
      'mechanism',
    );
    return html`<md-dialog id="mechanism-dialog">
      <div slot="headline">${t('structured.addMechanism')}</div>
      <div slot="content" class="dialog-form">
        <div class="workspace-card">
          <strong>${t('structured.mechanism')}</strong>
          <span class="muted">${t('structured.mechanismHelp')}</span>
        </div>
        <md-outlined-text-field
          label=${t('structured.mechanismName')}
          .value=${this.mechanismName}
          @input=${(event: Event) => (this.mechanismName = inputValue(event))}
        ></md-outlined-text-field>
        <md-outlined-select
          label=${t('structured.parent')}
          .value=${this.mechanismParentId}
          @change=${(event: Event) => (this.mechanismParentId = inputValue(event))}
        >
          ${parentOptions.map(
            (subsystem) =>
              html`<md-select-option value=${subsystem.id}
                ><div slot="headline">${this.presetParentLabel(subsystem)}</div></md-select-option
              >`,
          )}
        </md-outlined-select>
        <div class="workspace-card">
          <strong>${t('structured.generatedLocation')}</strong>
          <span class="path">${location}</span>
          <span class="muted">${t('structured.locationAutomatic')}</span>
        </div>
        <md-outlined-text-field
          label=${t('structured.notes')}
          type="textarea"
          rows="3"
          .value=${this.mechanismNotes}
          @input=${(event: Event) => (this.mechanismNotes = inputValue(event))}
        ></md-outlined-text-field>
      </div>
      <div slot="actions">
        <md-text-button @click=${() => this.dialog('mechanism-dialog')?.close()}
          >${t('create.cancel')}</md-text-button
        >
        <md-filled-button @click=${this.addMechanism}
          >${t('structured.addMechanism')}</md-filled-button
        >
      </div>
    </md-dialog>`;
  }

  private renderDeviceDialog(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const follower = this.deviceCatalogId === 'ironpulse.talonfx-follower';
    const definition = findComponentDefinition(this.deviceCatalogId);
    const canDevice =
      definition !== undefined && ['motor', 'encoder', 'gyro'].includes(definition.domainKind);
    const motors = this.model()?.devices.filter((device) => device.kind === 'motor') ?? [];
    return html`<md-dialog id="device-dialog">
      <div slot="headline">${t('structured.addDevice')}</div>
      <div slot="content" class="dialog-form">
        <md-outlined-select
          label=${t('structured.component')}
          .value=${this.deviceCatalogId}
          @change=${(event: Event) => (this.deviceCatalogId = inputValue(event))}
        >
          ${COMPONENT_CATALOG.map(
            (entry) =>
              html`<md-select-option value=${entry.id}
                ><div slot="headline">${entry.displayName}</div></md-select-option
              >`,
          )}
        </md-outlined-select>
        <md-outlined-text-field
          label=${t('structured.deviceName')}
          .value=${this.deviceName}
          @input=${(event: Event) => (this.deviceName = inputValue(event))}
        ></md-outlined-text-field>
        ${
          canDevice
            ? html`<div class="settings-grid">
                <md-outlined-text-field
                  label=${t('structured.canId')}
                  type="number"
                  .value=${this.deviceCanId}
                  @input=${(event: Event) => (this.deviceCanId = inputValue(event))}
                ></md-outlined-text-field>
                <md-outlined-text-field
                  label=${t('structured.canBus')}
                  .value=${this.deviceCanBus}
                  @input=${(event: Event) => (this.deviceCanBus = inputValue(event))}
                ></md-outlined-text-field>
              </div>`
            : nothing
        }
        ${
          follower
            ? html`<md-outlined-select
                  label=${t('structured.component')}
                  .value=${this.deviceLeaderId}
                  @change=${(event: Event) => (this.deviceLeaderId = inputValue(event))}
                >
                  ${motors.map((motor) => html`<md-select-option value=${motor.id}><div slot="headline">${motor.displayName}</div></md-select-option>`)}
                </md-outlined-select>
                <label class="control-row"
                  ><md-checkbox
                    aria-label=${t('structured.opposeLeader')}
                    ?checked=${this.deviceOpposeLeader}
                    @change=${(event: Event) => (this.deviceOpposeLeader = (event.target as HTMLInputElement).checked)}
                  ></md-checkbox
                  ><span>${t('structured.opposeLeader')}</span></label
                >`
            : nothing
        }
      </div>
      <div slot="actions">
        <md-text-button @click=${() => this.dialog('device-dialog')?.close()}
          >${t('create.cancel')}</md-text-button
        >
        <md-filled-button @click=${this.addDevice}>${t('structured.addDevice')}</md-filled-button>
      </div>
    </md-dialog>`;
  }

  private renderGoalDialog(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    return html`<md-dialog id="goal-dialog">
      <div slot="headline">${t('structured.addGoal')}</div>
      <div slot="content" class="dialog-form">
        <md-outlined-text-field
          label=${t('structured.goalName')}
          .value=${this.goalName}
          @input=${(event: Event) => (this.goalName = inputValue(event))}
        ></md-outlined-text-field>
      </div>
      <div slot="actions">
        <md-text-button @click=${() => this.dialog('goal-dialog')?.close()}
          >${t('create.cancel')}</md-text-button
        >
        <md-filled-button @click=${this.addGoal}>${t('structured.addGoal')}</md-filled-button>
      </div>
    </md-dialog>`;
  }

  private renderControllerDialog(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    return html`<md-dialog id="controller-dialog">
      <div slot="headline">${t('controls.addController')}</div>
      <div slot="content" class="dialog-form">
        <md-outlined-text-field
          label=${t('controls.controllerName')}
          .value=${this.controllerName}
          @input=${(event: Event) => (this.controllerName = inputValue(event))}
        ></md-outlined-text-field>
        <md-outlined-select
          label=${t('controls.provider')}
          .value=${this.controllerProvider}
          @change=${(event: Event) => (this.controllerProvider = inputValue(event))}
        >
          ${['CommandXboxController', 'CommandPS4Controller', 'CommandPS5Controller', 'CommandJoystick', 'CommandGenericHID'].map((provider) => html`<md-select-option value=${provider}><div slot="headline">${provider}</div></md-select-option>`)}
        </md-outlined-select>
        <div class="settings-grid">
          <md-outlined-text-field
            label=${t('controls.port')}
            type="number"
            .value=${this.controllerPort}
            @input=${(event: Event) => (this.controllerPort = inputValue(event))}
          ></md-outlined-text-field>
          <md-outlined-select
            label=${t('controls.role')}
            .value=${this.controllerRole}
            @change=${(event: Event) => (this.controllerRole = inputValue(event) as Controller['role'])}
          >
            <md-select-option value="driver"
              ><div slot="headline">${t('controls.roleDriver')}</div></md-select-option
            >
            <md-select-option value="operator"
              ><div slot="headline">${t('controls.roleOperator')}</div></md-select-option
            >
            <md-select-option value="custom"
              ><div slot="headline">${t('controls.roleCustom')}</div></md-select-option
            >
          </md-outlined-select>
        </div>
        <md-outlined-text-field
          label=${t('controls.layout')}
          .value=${this.controllerLayout}
          @input=${(event: Event) => (this.controllerLayout = inputValue(event))}
          supporting-text=${t('controls.layoutHint')}
        ></md-outlined-text-field>
      </div>
      <div slot="actions">
        <md-text-button @click=${() => this.dialog('controller-dialog')?.close()}
          >${t('create.cancel')}</md-text-button
        ><md-filled-button @click=${this.createController}
          >${t('controls.addController')}</md-filled-button
        >
      </div>
    </md-dialog>`;
  }

  private renderCommandDialog(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const model = this.model();
    return html`<md-dialog id="command-editor-dialog">
      <div slot="headline">${t('commands.add')}</div>
      <div slot="content" class="dialog-form">
        <md-outlined-text-field
          label=${t('commands.name')}
          .value=${this.commandName}
          @input=${(event: Event) => (this.commandName = inputValue(event))}
        ></md-outlined-text-field>
        <md-outlined-select
          label=${t('commands.kind')}
          .value=${this.commandKind}
          @change=${(event: Event) => (this.commandKind = inputValue(event) as CommandDefinition['kind'])}
        >
          ${['instant', 'run', 'sequence', 'parallel', 'race', 'deadline', 'either', 'custom'].map((kind) => html`<md-select-option value=${kind}><div slot="headline">${kind}</div></md-select-option>`)}
        </md-outlined-select>
        <md-outlined-select
          label=${t('commands.requirement')}
          .value=${this.commandRequirementId}
          @change=${(event: Event) => (this.commandRequirementId = inputValue(event))}
        >
          ${(model?.subsystems.filter((entry) => entry.parentId === undefined) ?? []).map((subsystem) => html`<md-select-option value=${subsystem.id}><div slot="headline">${subsystem.displayName}</div></md-select-option>`)}
        </md-outlined-select>
        <md-outlined-text-field
          label=${t('commands.codeExpression')}
          .value=${this.commandExpression}
          @input=${(event: Event) => (this.commandExpression = inputValue(event))}
        ></md-outlined-text-field>
        <md-outlined-text-field
          label=${t('commands.pathplannerName')}
          .value=${this.commandPathplannerName}
          @input=${(event: Event) => (this.commandPathplannerName = inputValue(event))}
        ></md-outlined-text-field>
        <label class="control-row"
          ><md-switch
            aria-label=${t('commands.freshFactory')}
            ?selected=${this.commandFactory}
            @change=${(event: Event) => (this.commandFactory = (event.target as HTMLElement & { selected: boolean }).selected)}
          ></md-switch
          ><span>${t('commands.freshFactory')}</span></label
        >
      </div>
      <div slot="actions">
        <md-text-button @click=${() => this.dialog('command-editor-dialog')?.close()}
          >${t('create.cancel')}</md-text-button
        ><md-filled-button @click=${this.addCommand}>${t('commands.add')}</md-filled-button>
      </div>
    </md-dialog>`;
  }

  private renderBindingDialog(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const model = this.model();
    return html`<md-dialog id="binding-dialog">
      <div slot="headline">${t('controls.addBinding')}</div>
      <div slot="content" class="dialog-form">
        <md-outlined-select
          label=${t('controls.controller')}
          .value=${this.bindingControllerId}
          @change=${(event: Event) => (this.bindingControllerId = inputValue(event))}
        >
          ${(model?.controllers ?? []).map((controller) => html`<md-select-option value=${controller.id}><div slot="headline">${controller.displayName}</div></md-select-option>`)}
        </md-outlined-select>
        <md-outlined-text-field
          label=${t('controls.bindingInput')}
          .value=${this.bindingInput}
          @input=${(event: Event) => (this.bindingInput = inputValue(event))}
        ></md-outlined-text-field>
        <md-outlined-select
          label=${t('controls.behavior')}
          .value=${this.bindingBehavior}
          @change=${(event: Event) => (this.bindingBehavior = inputValue(event) as FrcProjectModel['bindings'][number]['behavior'])}
        >
          ${['onTrue', 'onFalse', 'whileTrue', 'whileFalse', 'toggleOnTrue', 'toggleOnFalse'].map((behavior) => html`<md-select-option value=${behavior}><div slot="headline">${behavior}</div></md-select-option>`)}
        </md-outlined-select>
        <md-outlined-select
          label=${t('controls.command')}
          .value=${this.bindingCommandId}
          @change=${(event: Event) => (this.bindingCommandId = inputValue(event))}
        >
          ${(model?.commands ?? []).map(
            (command) =>
              html`<md-select-option value=${command.id}
                ><div slot="headline">${command.displayName}</div>
                <div slot="supporting-text">
                  ${command.kind} ·
                  ${command.requirementIds.map((id) => model?.subsystems.find((entry) => entry.id === id)?.displayName ?? '?').join(', ') || t('commands.noRequirements')}
                </div></md-select-option
              >`,
          )}
        </md-outlined-select>
      </div>
      <div slot="actions">
        <md-text-button @click=${() => this.dialog('binding-dialog')?.close()}
          >${t('create.cancel')}</md-text-button
        ><md-filled-button @click=${this.addBinding}>${t('controls.addBinding')}</md-filled-button>
      </div>
    </md-dialog>`;
  }

  private renderAutoDialog(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const model = this.model();
    return html`<md-dialog id="auto-dialog">
      <div slot="headline">${t('auto.add')}</div>
      <div slot="content" class="dialog-form">
        <md-outlined-text-field
          label=${t('auto.name')}
          .value=${this.autoName}
          @input=${(event: Event) => (this.autoName = inputValue(event))}
        ></md-outlined-text-field>
        <md-outlined-select
          label=${t('controls.command')}
          .value=${this.autoCommandId}
          @change=${(event: Event) => (this.autoCommandId = inputValue(event))}
        >
          ${(model?.commands ?? []).map((command) => html`<md-select-option value=${command.id}><div slot="headline">${command.displayName}</div></md-select-option>`)}
        </md-outlined-select>
        <md-outlined-text-field
          label=${t('auto.pathFiles')}
          .value=${this.autoPathFiles}
          @input=${(event: Event) => (this.autoPathFiles = inputValue(event))}
          supporting-text=${t('auto.pathHint')}
        ></md-outlined-text-field>
      </div>
      <div slot="actions">
        <md-text-button @click=${() => this.dialog('auto-dialog')?.close()}
          >${t('create.cancel')}</md-text-button
        >
        <md-filled-button @click=${this.addAutoRoutine}>${t('auto.add')}</md-filled-button>
      </div>
    </md-dialog>`;
  }

  private renderPresetDialog(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const swerve = this.presetKind === 'frc.swerve';
    const manifest = PRESET_MANIFESTS.find((entry) => entry.id === this.presetKind);
    const commonUsesCan = this.presetKind !== 'frc.led-indicator';
    const commonUsesChannel = ['frc.beambreak-indexer', 'frc.led-indicator'].includes(
      this.presetKind,
    );
    const commonUsesFollowers = ['frc.velocity-flywheel', 'frc.position-mechanism'].includes(
      this.presetKind,
    );
    const commonUsesSetpoints = ['frc.velocity-flywheel', 'frc.position-mechanism'].includes(
      this.presetKind,
    );
    return html`<md-dialog id="preset-dialog">
      <div slot="headline">${t('presets.add')}</div>
      <div slot="content" class="dialog-form">
        <md-outlined-select
          label=${t('presets.module')}
          .value=${this.presetKind}
          @change=${(event: Event) => this.selectPresetKind(inputValue(event))}
        >
          ${PRESET_MANIFESTS.map(
            (manifest) =>
              html`<md-select-option value=${manifest.id}
                ><div slot="headline">${manifest.displayName}</div></md-select-option
              >`,
          )}
        </md-outlined-select>
        ${
          manifest === undefined
            ? nothing
            : html`<div class="workspace-card">
                <strong>${manifest.displayName}</strong>
                <span>${this.localizedPresetText(manifest.summary)}</span>
                <span class="muted"
                  ><strong>${t('presets.quickStart')}:</strong>
                  ${this.localizedPresetText(manifest.quickStart)}</span
                >
                <span class="muted">${t('presets.includes')}: ${manifest.outputs.join(' · ')}</span>
                <span class="muted">${t('presets.readyDefaults')}</span>
              </div>`
        }
        ${
          swerve
            ? html`
                ${this.presetTextField(
                  'presets.geometry',
                  this.swerveGeometry,
                  (value) => (this.swerveGeometry = value),
                )}
                <div class="settings-grid">
                  ${this.presetTextField(
                    'presets.maxSpeed',
                    this.swerveMaxSpeed,
                    (value) => (this.swerveMaxSpeed = value),
                  )}
                  ${this.presetTextField(
                    'presets.canBus',
                    this.swerveCanBus,
                    (value) => (this.swerveCanBus = value),
                  )}
                </div>
                <div class="settings-grid">
                  ${this.presetTextField(
                    'presets.driveRatio',
                    this.swerveDriveRatio,
                    (value) => (this.swerveDriveRatio = value),
                  )}
                  ${this.presetTextField(
                    'presets.steerRatio',
                    this.swerveSteerRatio,
                    (value) => (this.swerveSteerRatio = value),
                  )}
                </div>
                ${this.presetTextField(
                  'presets.driveIds',
                  this.swerveDriveIds,
                  (value) => (this.swerveDriveIds = value),
                )}
                ${this.presetTextField(
                  'presets.steerIds',
                  this.swerveSteerIds,
                  (value) => (this.swerveSteerIds = value),
                )}
                ${this.presetTextField(
                  'presets.encoderIds',
                  this.swerveEncoderIds,
                  (value) => (this.swerveEncoderIds = value),
                )}
                ${this.presetTextField(
                  'presets.encoderOffsets',
                  this.swerveOffsets,
                  (value) => (this.swerveOffsets = value),
                )}
                <div class="settings-grid">
                  ${this.presetTextField(
                    'presets.driveGains',
                    this.swerveDriveGains,
                    (value) => (this.swerveDriveGains = value),
                  )}
                  ${this.presetTextField(
                    'presets.steerGains',
                    this.swerveSteerGains,
                    (value) => (this.swerveSteerGains = value),
                  )}
                </div>
                ${this.presetTextField(
                  'presets.currentLimits',
                  this.swerveCurrentLimits,
                  (value) => (this.swerveCurrentLimits = value),
                )}
                ${this.presetTextField(
                  'presets.pathGains',
                  this.swervePathGains,
                  (value) => (this.swervePathGains = value),
                )}
                <div class="settings-grid">
                  ${this.presetTextField(
                    'presets.gyro',
                    this.swerveGyroId,
                    (value) => (this.swerveGyroId = value),
                  )}
                  ${this.presetTextField(
                    'presets.gyroMount',
                    this.swerveGyroMount,
                    (value) => (this.swerveGyroMount = value),
                  )}
                </div>
                <label class="control-row"
                  ><md-checkbox
                    aria-label=${t('presets.driveInverted')}
                    ?checked=${this.swerveDriveInverted}
                    @change=${(event: Event) =>
                      (this.swerveDriveInverted = (event.target as HTMLInputElement).checked)}
                  ></md-checkbox
                  ><span>${t('presets.driveInverted')}</span></label
                >
                <label class="control-row"
                  ><md-checkbox
                    aria-label=${t('presets.steerInverted')}
                    ?checked=${this.swerveSteerInverted}
                    @change=${(event: Event) =>
                      (this.swerveSteerInverted = (event.target as HTMLInputElement).checked)}
                  ></md-checkbox
                  ><span>${t('presets.steerInverted')}</span></label
                >
              `
            : this.presetKind === 'frc.limelight'
              ? html`
                  ${this.presetTextField(
                    'presets.limelightDevice',
                    this.limelightDeviceName,
                    (value) => (this.limelightDeviceName = value),
                  )}
                  ${this.presetTextField(
                    'presets.table',
                    this.limelightTable,
                    (value) => (this.limelightTable = value),
                  )}
                  ${this.presetTextField(
                    'presets.pipeline',
                    this.limelightPipelineStream,
                    (value) => (this.limelightPipelineStream = value),
                  )}
                  ${this.presetTextField(
                    'presets.limelightTransform',
                    this.limelightTransform,
                    (value) => (this.limelightTransform = value),
                  )}
                `
              : html`
                  <md-outlined-select
                    label=${t('presets.parent')}
                    .value=${this.commonPresetParentId}
                    @change=${(event: Event) => (this.commonPresetParentId = inputValue(event))}
                  >
                    <md-select-option value=""
                      ><div slot="headline">${t('presets.projectRoot')}</div></md-select-option
                    >
                    ${(this.model()?.subsystems ?? []).map(
                      (subsystem) =>
                        html`<md-select-option value=${subsystem.id}
                          ><div slot="headline">
                            ${this.presetParentLabel(subsystem)}
                          </div></md-select-option
                        >`,
                    )}
                  </md-outlined-select>
                  <md-outlined-text-field
                    label=${this.#i18n.locale === 'zh-CN' ? '机制名称' : 'Mechanism name'}
                    .value=${this.commonPresetName}
                    @input=${(event: Event) => (this.commonPresetName = inputValue(event))}
                  ></md-outlined-text-field>
                  ${
                    commonUsesCan
                      ? html`<div class="settings-grid">
                          <md-outlined-text-field
                            label=${t('structured.canId')}
                            type="number"
                            .value=${this.commonPresetCanId}
                            @input=${(event: Event) => (this.commonPresetCanId = inputValue(event))}
                          ></md-outlined-text-field>
                          <md-outlined-text-field
                            label=${t('presets.canBus')}
                            .value=${this.commonPresetCanBus}
                            @input=${(event: Event) =>
                              (this.commonPresetCanBus = inputValue(event))}
                          ></md-outlined-text-field>
                        </div>`
                      : nothing
                  }
                  ${
                    commonUsesChannel
                      ? html`<md-outlined-text-field
                          label=${t('structured.channel')}
                          type="number"
                          .value=${this.commonPresetChannel}
                          @input=${(event: Event) => (this.commonPresetChannel = inputValue(event))}
                        ></md-outlined-text-field>`
                      : nothing
                  }
                  ${
                    commonUsesFollowers
                      ? html`<md-outlined-text-field
                          label=${this.#i18n.locale === 'zh-CN' ? 'Follower CAN IDs（逗号分隔，可留空）' : 'Follower CAN IDs (comma separated, optional)'}
                          .value=${this.commonPresetFollowers}
                          @input=${(event: Event) => (this.commonPresetFollowers = inputValue(event))}
                        ></md-outlined-text-field>`
                      : nothing
                  }
                  ${
                    commonUsesSetpoints
                      ? html`
                          <md-outlined-text-field
                            label=${this.#i18n.locale === 'zh-CN' ? '命名设定值' : 'Named setpoints'}
                            .value=${this.commonPresetSetpoints}
                            @input=${(event: Event) => (this.commonPresetSetpoints = inputValue(event))}
                          ></md-outlined-text-field>
                          <md-outlined-select
                            label=${this.#i18n.locale === 'zh-CN' ? '设定值单位' : 'Setpoint unit'}
                            .value=${this.commonPresetUnit}
                            @change=${(event: Event) => (this.commonPresetUnit = inputValue(event))}
                          >
                            ${(this.presetKind === 'frc.velocity-flywheel'
                              ? ['rps', 'rpm']
                              : ['rot', 'deg', 'rad']
                            ).map(
                              (unit) =>
                                html`<md-select-option value=${unit}
                                  ><div slot="headline">${unit}</div></md-select-option
                                >`,
                            )}
                          </md-outlined-select>
                        `
                      : nothing
                  }
                `
        }
      </div>
      <div slot="actions">
        <md-text-button @click=${() => this.dialog('preset-dialog')?.close()}
          >${t('create.cancel')}</md-text-button
        >
        <md-filled-button @click=${this.createPreset}>${t('presets.add')}</md-filled-button>
      </div>
    </md-dialog>`;
  }

  private presetTextField(
    key: TranslationKey,
    value: string,
    update: (value: string) => void,
  ): TemplateResult {
    return html`<md-outlined-text-field
      label=${this.#i18n.t(key)}
      .value=${value}
      @input=${(event: Event) => update(inputValue(event))}
    ></md-outlined-text-field>`;
  }

  private localizedPresetText(copy: { readonly en: string; readonly zhCN: string }): string {
    return this.#i18n.locale === 'zh-CN' ? copy.zhCN : copy.en;
  }

  private renderDeployDialog(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const model = this.model();
    const context = this.toolchainInfo?.deploy;
    const blocked =
      context?.pendingStructuredChanges === true ||
      (context?.externallyModifiedFiles ?? 0) > 0 ||
      this.preview !== undefined;
    return html`<md-dialog id="deploy-dialog">
      <div slot="headline">${t('toolchain.deployConfirm')}</div>
      <div slot="content" class="dialog-form">
        <p>${t('toolchain.deployWarning')}</p>
        <div class="workspace-card">
          <strong>Team ${String(model?.project.teamNumber ?? 0)}</strong>
          <span class="muted">${this.project?.path ?? ''}</span>
        </div>
        <div class="hierarchy-list">
          <div class="hierarchy-row">
            <span>${this.#i18n.locale === 'zh-CN' ? '目标' : 'Target'}</span
            ><span class="path">${context?.target ?? '—'}</span>
          </div>
          <div class="hierarchy-row">
            <span>Git</span
            ><span class="tree-badge"
              >${context?.gitBranch ?? 'not a repository'} ·
              ${context?.gitDirty === true ? 'dirty' : 'clean'}</span
            >
          </div>
          <div class="hierarchy-row">
            <span
              >${this.#i18n.locale === 'zh-CN' ? '未应用/外部文件' : 'Pending / external files'}</span
            ><span class="tree-badge"
              >${String(Number(context?.pendingStructuredChanges === true || this.preview !== undefined))}
              / ${String(context?.externallyModifiedFiles ?? 0)}</span
            >
          </div>
          <div class="hierarchy-row">
            <span>${this.#i18n.locale === 'zh-CN' ? '最近构建' : 'Last build'}</span
            ><span class="tree-badge"
              >${context?.lastBuildState ?? 'not run'}${context?.lastBuildAt === undefined ? '' : ` · ${new Date(context.lastBuildAt).toLocaleString()}`}</span
            >
          </div>
        </div>
        ${blocked ? html`<span class="problem-text">${this.#i18n.locale === 'zh-CN' ? '请先应用/放弃待处理修改并解决外部文件冲突。' : 'Apply or discard pending changes and resolve external file conflicts first.'}</span>` : nothing}
      </div>
      <div slot="actions">
        <md-text-button @click=${() => this.dialog('deploy-dialog')?.close()}
          >${t('create.cancel')}</md-text-button
        >
        <md-filled-button @click=${this.confirmDeploy} ?disabled=${blocked}
          >${t('toolchain.deploy')}</md-filled-button
        >
      </div>
    </md-dialog>`;
  }

  private renderDeleteImpactDialog(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const impact = this.deleteImpact;
    return html`<md-dialog id="delete-impact-dialog">
      <div slot="headline">${t('tree.deleteTitle')}</div>
      <div slot="content" class="dialog-form">
        <p>
          ${impact === undefined ? '' : t('tree.deleteDescription').replace('{name}', impact.label)}
        </p>
        <strong>${t('tree.references')}</strong>
        <div class="path">${impact?.references.join(' · ') || t('tree.noReferences')}</div>
        <strong>${t('diff.files')}</strong>
        <div class="path">${impact?.files.join(' · ') ?? ''}</div>
      </div>
      <div slot="actions">
        <md-text-button @click=${() => this.dialog('delete-impact-dialog')?.close()}
          >${t('create.cancel')}</md-text-button
        >
        <md-filled-button @click=${this.confirmDeleteSelected}
          >${t('tree.delete')}</md-filled-button
        >
      </div>
    </md-dialog>`;
  }

  private renderReferenceImpactDialog(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    return html`<md-dialog id="reference-impact-dialog">
      <div slot="headline">${t('inspector.referencePreview')}</div>
      <div slot="content" class="dialog-form">
        <strong>${t('inspector.dependencyGraph')}</strong>
        <div class="path">${this.referenceImpact?.graph.join(' · ') ?? ''}</div>
        <strong>${t('diff.files')}</strong>
        <div class="path">${this.referenceImpact?.files.join(' · ') ?? ''}</div>
      </div>
      <div slot="actions">
        <md-text-button @click=${() => this.dialog('reference-impact-dialog')?.close()}
          >${t('create.cancel')}</md-text-button
        >
        <md-filled-button @click=${this.confirmSubsystemReference}
          >${t('inspector.addReference')}</md-filled-button
        >
      </div>
    </md-dialog>`;
  }

  private renderExternalChangeDialog(): TemplateResult {
    const zh = this.#i18n.locale === 'zh-CN';
    const hasConflict = this.externalChanges.some((event) => event.conflict);
    return html`<md-dialog id="external-change-dialog">
      <div slot="headline">${zh ? '检测到外部代码改动' : 'External code changes detected'}</div>
      <div slot="content" class="dialog-form">
        <p>
          ${
            hasConflict
              ? zh
                ? '这些文件在软件中仍有待应用的修改。请选择处理方式；不会自动覆盖任何一侧。'
                : 'These files also have pending app changes. Choose a resolution; neither side will be overwritten automatically.'
              : zh
                ? '文件已被 VS Code 或其他工具修改。标准结构可以比较后同步，复杂逻辑应继续在代码中调试。'
                : 'Files changed in VS Code or another tool. Recognized structure can be reviewed for synchronization; complex logic remains code-owned.'
          }
        </p>
        <div class="hierarchy-list">
          ${this.externalChanges.map(
            (event) =>
              html`<button class="hierarchy-row" @click=${() => this.openSourceFile(event.path)}>
                <span
                  ><strong>${event.path}</strong><br /><span class="muted"
                    >${event.kind}</span
                  ></span
                >
                <span class="tree-badge">${event.conflict ? 'conflict' : 'external'}</span>
              </button>`,
          )}
        </div>
      </div>
      <div slot="actions">
        <md-text-button @click=${() => this.resolveExternalChanges('reload')}
          >${zh ? '从磁盘重新载入' : 'Reload from disk'}</md-text-button
        >
        <md-text-button @click=${() => this.resolveExternalChanges('compare')}
          >${zh ? '比较' : 'Compare'}</md-text-button
        >
        <md-text-button @click=${() => this.resolveExternalChanges('keep-code')}
          >${zh ? '保留代码并取消托管' : 'Keep code & unmanage'}</md-text-button
        >
        <md-filled-button @click=${() => this.resolveExternalChanges('regenerate')}
          >${zh ? '从模型重新生成' : 'Regenerate from model'}</md-filled-button
        >
      </div>
    </md-dialog>`;
  }

  private renderSettingsDialog(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    return html`<md-dialog id="settings-dialog">
      <div slot="headline">${t('settings.title')}</div>
      <div slot="content" class="dialog-form">
        <div class="settings-grid">
          <md-outlined-select
            label=${t('settings.language')}
            .value=${this.settings.language}
            @change=${this.changeLanguage}
          >
            <md-select-option value="system"
              ><div slot="headline">${t('settings.languageSystem')}</div></md-select-option
            >
            <md-select-option value="en"
              ><div slot="headline">${t('settings.languageEnglish')}</div></md-select-option
            >
            <md-select-option value="zh-CN"
              ><div slot="headline">${t('settings.languageChinese')}</div></md-select-option
            >
          </md-outlined-select>
          <md-outlined-select
            label=${t('settings.theme')}
            .value=${this.settings.theme}
            @change=${this.changeTheme}
          >
            <md-select-option value="dark"
              ><div slot="headline">${t('settings.darkTheme')}</div></md-select-option
            >
            <md-select-option value="system"
              ><div slot="headline">${t('settings.systemTheme')}</div></md-select-option
            >
          </md-outlined-select>
          <md-outlined-select
            label=${t('settings.logLevel')}
            .value=${this.settings.logLevel}
            @change=${this.changeLogLevel}
          >
            <md-select-option value="debug"
              ><div slot="headline">${t('settings.logDebug')}</div></md-select-option
            >
            <md-select-option value="info"
              ><div slot="headline">${t('settings.logInfo')}</div></md-select-option
            >
            <md-select-option value="warning"
              ><div slot="headline">${t('settings.logWarning')}</div></md-select-option
            >
            <md-select-option value="error"
              ><div slot="headline">${t('settings.logError')}</div></md-select-option
            >
          </md-outlined-select>
          <md-outlined-select
            label=${t('settings.editor')}
            .value=${this.settings.editor?.id ?? ''}
            @change=${this.changeEditor}
          >
            ${this.availableEditors().map(
              (editor) =>
                html`<md-select-option value=${editor.id}
                  ><div slot="headline">${editor.name}</div></md-select-option
                >`,
            )}
          </md-outlined-select>
          <md-outlined-select
            label=${t('settings.projectEditor')}
            data-settings-field="projectEditor"
            .value=${this.projectEditorId()}
            @change=${this.changeProjectEditor}
            ?disabled=${this.model() === undefined}
          >
            <md-select-option value=""
              ><div slot="headline">${t('settings.useDefaultEditor')}</div></md-select-option
            >
            ${this.availableEditors().map(
              (editor) =>
                html`<md-select-option value=${editor.id}
                  ><div slot="headline">${editor.name}</div></md-select-option
                >`,
            )}
          </md-outlined-select>
        </div>
        <div class="settings-grid">
          <md-outlined-text-field
            label=${t('settings.defaultTeam')}
            type="number"
            .value=${String(this.settings.defaultProject.teamNumber)}
            @change=${this.changeDefaultProject}
            data-default-field="teamNumber"
          ></md-outlined-text-field>
          <md-outlined-text-field
            label=${t('settings.defaultJavaPackage')}
            .value=${this.settings.defaultProject.javaPackage}
            @change=${this.changeDefaultProject}
            data-default-field="javaPackage"
          ></md-outlined-text-field>
          <md-outlined-select
            label=${t('settings.defaultWpilibYear')}
            .value=${String(this.settings.defaultProject.wpilibYear)}
            @change=${this.changeDefaultProject}
            data-default-field="wpilibYear"
          >
            <md-select-option value="2026"><div slot="headline">2026</div></md-select-option>
          </md-outlined-select>
        </div>
        <h3>${t('settings.externalTools')}</h3>
        ${this.renderExternalToolSetting('advantagescope', 'AdvantageScope')}
        ${this.renderExternalToolSetting('pathplanner', 'PathPlanner')}
        <label class="control-row">
          <md-switch
            aria-label=${t('settings.compact')}
            ?selected=${this.settings.density === 'compact'}
            @change=${this.toggleDensity}
          ></md-switch>
          <span>${t('settings.compact')}</span>
        </label>
        <label class="control-row">
          <md-switch
            aria-label=${t('workspace.preview')}
            ?selected=${this.settings.previewChanges}
            @change=${this.togglePreviewChanges}
          ></md-switch>
          <span>${t('workspace.preview')}</span>
        </label>
        <md-outlined-text-field
          label=${t('settings.editorExecutable')}
          data-settings-field="editorExecutable"
          .value=${this.customEditorExecutable}
          @input=${(event: Event) => (this.customEditorExecutable = inputValue(event))}
        ></md-outlined-text-field>
        <md-outlined-text-field
          label=${t('settings.editorArguments')}
          type="textarea"
          rows="4"
          .value=${this.customEditorArguments}
          @input=${(event: Event) => (this.customEditorArguments = inputValue(event))}
        ></md-outlined-text-field>
        <div class="dialog-actions">
          <md-outlined-button @click=${this.saveCustomEditor}
            >${t('settings.saveCustomEditor')}</md-outlined-button
          >
          <md-outlined-button @click=${this.testEditor}
            >${t('settings.testEditor')}</md-outlined-button
          >
          <md-text-button @click=${this.openHelp}>${t('help.shortcuts')}</md-text-button>
        </div>
      </div>
      <div slot="actions">
        <md-filled-button @click=${() => this.dialog('settings-dialog')?.close()}>
          ${t('app.done')}
        </md-filled-button>
      </div>
    </md-dialog>`;
  }

  private renderCommandPalette(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    return html`<md-dialog id="command-dialog">
      <div slot="headline">${t('commandPalette.title')}</div>
      <div slot="content" class="dialog-form">
        <md-outlined-text-field label=${t('commandPalette.placeholder')}></md-outlined-text-field>
        <md-list>
          <md-list-item type="button" @click=${this.commandOpenProject}>
            <md-icon slot="start">folder_open</md-icon>
            <span slot="headline">${t('home.choose')}</span>
          </md-list-item>
          <md-list-item type="button" @click=${this.commandCreateProject}>
            <md-icon slot="start">create_new_folder</md-icon>
            <span slot="headline">${t('home.create')}</span>
          </md-list-item>
          <md-list-item type="button" @click=${this.commandSettings}>
            <md-icon slot="start">settings</md-icon>
            <span slot="headline">${t('settings.title')}</span>
          </md-list-item>
        </md-list>
      </div>
    </md-dialog>`;
  }

  private renderHelpDialog(): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    return html`<md-dialog id="help-dialog">
      <div slot="headline">${t('help.shortcuts')}</div>
      <div slot="content" class="dialog-form">
        <div class="shortcut"><span>${t('help.commandPalette')}</span><kbd>Ctrl K</kbd></div>
        <div class="shortcut"><span>${t('help.openProject')}</span><kbd>Ctrl O</kbd></div>
        <div class="shortcut"><span>${t('help.showHelp')}</span><kbd>Ctrl /</kbd></div>
      </div>
      <div slot="actions">
        <md-filled-button @click=${() => this.dialog('help-dialog')?.close()}>
          ${t('app.done')}
        </md-filled-button>
      </div>
    </md-dialog>`;
  }

  private async initialize(): Promise<void> {
    try {
      const [settings, layout, recentProjects, editors, appInfo] = await Promise.all([
        window.framework.settings.get(),
        window.framework.window.getState(),
        window.framework.recent.list(),
        window.framework.editor.detect(),
        window.framework.app.getInfo(),
      ]);
      this.settings = settings;
      this.#preferredPanelWidths = {
        inspectorWidth: layout.inspectorWidth,
        leftPanelWidth: layout.leftPanelWidth,
      };
      this.layout = constrainPanelLayout(layout, window.innerWidth);
      this.recentProjects = recentProjects;
      this.editors = editors;
      this.appInfo = appInfo;
      this.createTeam = String(settings.defaultProject.teamNumber);
      this.createPackage = settings.defaultProject.javaPackage;
      this.createYear = String(settings.defaultProject.wpilibYear);
      this.applyLocale(settings);
      this.setAttribute('density', settings.density);
      this.setAttribute('theme', settings.theme);
    } catch (error) {
      this.showError(error);
    }
  }

  private readonly chooseDirectory = async (): Promise<void> => {
    await this.run(async () => {
      const selection = await window.framework.project.chooseDirectory();
      if (selection.canceled) return;
      this.directorySelection = selection;
      if (selection.kind === 'empty') {
        this.openCreateDialog();
      } else if (selection.kind === 'frc-project' && selection.path !== undefined) {
        this.project = await window.framework.project.openPath(selection.path);
        this.restoreTreeState(this.project);
        await this.refreshRecent();
      }
    });
  };

  private readonly createProject = async (): Promise<void> => {
    const root = this.directorySelection?.path;
    if (root === undefined || this.directorySelection?.kind !== 'empty') {
      this.dialog('create-dialog')?.close();
      await this.chooseDirectory();
      return;
    }
    await this.run(async () => {
      this.project = await window.framework.project.create({
        javaPackage: this.createPackage.trim(),
        name: this.createName.trim(),
        path: root,
        teamNumber: Number(this.createTeam),
        wpilibYear: Number(this.createYear),
      });
      this.restoreTreeState(this.project);
      this.dialog('create-dialog')?.close();
      this.notice = this.project.path;
      await this.refreshRecent();
    });
  };

  private readonly migrateProject = async (): Promise<void> => {
    await this.run(async () => {
      this.project = await window.framework.project.migrate();
      this.restoreTreeState(this.project);
      this.notice = this.project.path;
    });
  };

  private async openRecent(recent: RecentProject): Promise<void> {
    if (!recent.available) return;
    await this.run(async () => {
      this.project = await window.framework.project.openPath(recent.path);
      this.restoreTreeState(this.project);
      this.notice = this.project.path;
      await this.refreshRecent();
    });
  }

  private async refreshRecent(): Promise<void> {
    this.recentProjects = await window.framework.recent.list();
  }

  private async removeRecent(event: Event, recent: RecentProject): Promise<void> {
    event.stopPropagation();
    this.recentProjects = await window.framework.recent.remove(recent.path);
  }

  private async relinkRecent(event: Event, recent: RecentProject): Promise<void> {
    event.stopPropagation();
    this.recentProjects = await window.framework.recent.relink(recent.path);
  }

  private selectedEntity(): Subsystem | Device | undefined {
    const model = this.model();
    return (
      model?.subsystems.find((entry) => entry.id === this.selectedEntityId) ??
      model?.devices.find((entry) => entry.id === this.selectedEntityId)
    );
  }

  private selectedSubsystem(): Subsystem | undefined {
    const model = this.model();
    const selected = this.selectedEntity();
    if (model === undefined || selected === undefined) return undefined;
    return 'parameters' in selected
      ? model.subsystems.find((entry) => entry.id === selected.parentId)
      : selected;
  }

  private isUnmanagedPath(model: FrcProjectModel, filePath: string | undefined): boolean {
    if (filePath === undefined) return false;
    const normalized = filePath.replace(/\\/gu, '/');
    return model.unmanagedFiles.some((entry) => entry.replace(/\\/gu, '/') === normalized);
  }

  private isSubsystemSourceReadOnly(model: FrcProjectModel, subsystem: Subsystem): boolean {
    const byId = new Map(model.subsystems.map((entry) => [entry.id, entry]));
    let cursor: Subsystem | undefined = subsystem;
    while (cursor !== undefined) {
      if (this.isUnmanagedPath(model, cursor.javaFile)) return true;
      cursor = cursor.parentId === undefined ? undefined : byId.get(cursor.parentId);
    }
    if (subsystem.javaFile === undefined) {
      const descendants = new Set([subsystem.id]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const candidate of model.subsystems) {
          if (
            candidate.parentId !== undefined &&
            descendants.has(candidate.parentId) &&
            !descendants.has(candidate.id)
          ) {
            descendants.add(candidate.id);
            changed = true;
          }
        }
      }
      return model.subsystems.some(
        (candidate) =>
          descendants.has(candidate.id) && this.isUnmanagedPath(model, candidate.javaFile),
      );
    }
    return false;
  }

  private isEntitySourceReadOnly(model: FrcProjectModel, entity: Subsystem | Device): boolean {
    const subsystem =
      'parameters' in entity
        ? model.subsystems.find((entry) => entry.id === entity.parentId)
        : entity;
    return subsystem !== undefined && this.isSubsystemSourceReadOnly(model, subsystem);
  }

  private selectedStructureReadOnly(): boolean {
    const model = this.model();
    const selected = this.selectedEntity();
    return model !== undefined && selected !== undefined
      ? this.isEntitySourceReadOnly(model, selected)
      : false;
  }

  private revealEntityInTree(model: FrcProjectModel, entityId: string): void {
    const expanded = new Set(this.expandedEntityIds);
    expanded.add(model.robot.id);
    const subsystemById = new Map(model.subsystems.map((entry) => [entry.id, entry]));
    let subsystem = subsystemById.get(entityId);
    const device = model.devices.find((entry) => entry.id === entityId);
    subsystem ??= device === undefined ? undefined : subsystemById.get(device.parentId);
    const visited = new Set<string>();
    while (subsystem !== undefined && !visited.has(subsystem.id)) {
      visited.add(subsystem.id);
      expanded.add(subsystem.id);
      subsystem =
        subsystem.parentId === undefined ? undefined : subsystemById.get(subsystem.parentId);
    }
    this.treeMode = 'logic';
    this.treeSearch = '';
    this.expandedEntityIds = expanded;
    this.selectedEntityId = entityId;
  }

  private readonly openSubsystemDialog = (): void => {
    const model = this.model();
    this.subsystemName = '';
    this.subsystemKind = 'subsystem';
    this.subsystemBehavior = 'direct';
    const selected = this.selectedSubsystem();
    this.subsystemParentId =
      model !== undefined &&
      selected !== undefined &&
      !this.isSubsystemSourceReadOnly(model, selected)
        ? selected.id
        : '';
    this.dialog('subsystem-dialog')?.show();
  };

  private readonly openMechanismDialog = (): void => {
    if (this.selectedStructureReadOnly()) {
      this.notice = this.#i18n.t('structured.importedReadOnlyHint');
      return;
    }
    this.mechanismName = '';
    this.mechanismParentId = this.selectedSubsystem()?.id ?? '';
    this.mechanismNotes = '';
    this.dialog('mechanism-dialog')?.show();
  };

  private readonly openDeviceDialog = (): void => {
    if (this.selectedStructureReadOnly()) {
      this.notice = this.#i18n.t('structured.importedReadOnlyHint');
      return;
    }
    this.deviceName = '';
    this.deviceCanId = '0';
    this.deviceCanBus = 'rio';
    this.deviceLeaderId = '';
    this.deviceOpposeLeader = false;
    this.dialog('device-dialog')?.show();
  };

  private readonly openGoalDialog = (): void => {
    if (this.selectedStructureReadOnly()) {
      this.notice = this.#i18n.t('structured.importedReadOnlyHint');
      return;
    }
    this.goalName = '';
    this.dialog('goal-dialog')?.show();
  };

  private readonly openControllerDialog = (): void => {
    const used = new Set(this.model()?.controllers.map((entry) => entry.port) ?? []);
    let port = 0;
    while (used.has(port)) port += 1;
    this.controllerName = '';
    this.controllerPort = String(port);
    this.controllerProvider = 'CommandXboxController';
    this.controllerRole = port === 0 ? 'driver' : 'operator';
    this.controllerLayout = '';
    this.dialog('controller-dialog')?.show();
  };

  private readonly openCommandDialog = (): void => {
    this.commandName = '';
    this.commandKind = 'custom';
    this.commandRequirementId =
      this.model()?.subsystems.find((entry) => entry.parentId === undefined)?.id ?? '';
    this.commandExpression = '';
    this.commandFactory = true;
    this.commandPathplannerName = '';
    this.dialog('command-editor-dialog')?.show();
  };

  private readonly openBindingDialog = (): void => {
    this.bindingControllerId = this.model()?.controllers[0]?.id ?? '';
    this.bindingCommandId = this.model()?.commands[0]?.id ?? '';
    this.bindingInput = '';
    this.bindingBehavior = 'onTrue';
    this.dialog('binding-dialog')?.show();
  };

  private readonly openAutoDialog = (): void => {
    this.autoName = '';
    this.autoCommandId = this.model()?.commands[0]?.id ?? '';
    this.autoPathFiles = '';
    this.dialog('auto-dialog')?.show();
  };

  private selectPresetKind(presetId: string): void {
    this.presetKind = presetId;
    const defaults: Readonly<Record<string, readonly [string, string, string]>> = {
      'frc.beambreak-indexer': ['Indexer', '20', 'rot'],
      'frc.led-indicator': ['LEDs', '0', ''],
      'frc.percent-output': ['Intake', '20', ''],
      'frc.position-mechanism': ['Arm', '20', 'rot'],
      'frc.velocity-flywheel': ['Shooter', '20', 'rps'],
    };
    const selected = defaults[presetId];
    if (selected === undefined) return;
    this.commonPresetName = selected[0];
    this.commonPresetCanId = selected[1];
    this.commonPresetUnit = selected[2];
    this.commonPresetFollowers = '';
    this.commonPresetSetpoints =
      presetId === 'frc.velocity-flywheel'
        ? 'IDLE=0, ACTIVE=80'
        : presetId === 'frc.position-mechanism'
          ? 'HOME=0, ACTIVE=1'
          : 'IDLE=0, ACTIVE=1';
  }

  private readonly openPresetDialog = (): void => {
    const selected = this.selectedSubsystem();
    this.commonPresetParentId = selected?.id ?? '';
    this.dialog('preset-dialog')?.show();
  };

  private presetParentLabel(subsystem: Subsystem): string {
    const model = this.model();
    if (model === undefined) return subsystem.displayName;
    const names = [subsystem.displayName];
    const visited = new Set<string>([subsystem.id]);
    let parentId = subsystem.parentId;
    while (parentId !== undefined && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = model.subsystems.find((entry) => entry.id === parentId);
      if (parent === undefined) break;
      names.unshift(parent.displayName);
      parentId = parent.parentId;
    }
    return names.join(' / ');
  }

  private editableSubsystems(): readonly Subsystem[] {
    const model = this.model();
    if (model === undefined) return [];
    return model.subsystems.filter(
      (subsystem) => !this.isSubsystemSourceReadOnly(model, subsystem),
    );
  }

  private prospectiveSubsystemLocation(
    name: string,
    parentId: string,
    kind: Subsystem['kind'],
  ): string {
    const model = this.model();
    if (model === undefined) return '';
    const symbol = javaSymbol(name.trim(), kind === 'mechanism' ? 'Mechanism' : 'Subsystem');
    const preview: Subsystem = {
      displayName: name.trim() || symbol,
      id: '__location_preview__',
      kind,
      ...(parentId.length === 0 ? {} : { parentId }),
      symbol,
    };
    try {
      return subsystemJavaLocation(
        { ...model, subsystems: [...model.subsystems, preview] },
        preview,
      ).file;
    } catch {
      return '';
    }
  }

  private subsystemParentOptions(subsystem: Subsystem): readonly Subsystem[] {
    const model = this.model();
    if (model === undefined) return [];
    return this.editableSubsystems().filter((candidate) => {
      if (candidate.id === subsystem.id) return false;
      let cursor: Subsystem | undefined = candidate;
      const visited = new Set<string>();
      while (cursor !== undefined && !visited.has(cursor.id)) {
        if (cursor.id === subsystem.id) return false;
        visited.add(cursor.id);
        cursor =
          cursor.parentId === undefined
            ? undefined
            : model.subsystems.find((entry) => entry.id === cursor?.parentId);
      }
      return true;
    });
  }

  private readonly createPreset = async (): Promise<void> => {
    const model = this.model();
    if (model === undefined) return;
    try {
      const next =
        this.presetKind === 'frc.swerve'
          ? instantiateSwervePreset(model, {
              canBus: this.swerveCanBus.trim() || 'rio',
              driveIds: tuple4(this.swerveDriveIds),
              driveInverted: this.swerveDriveInverted,
              driveKP: tuple(this.swerveDriveGains, 2)[0] ?? 0,
              driveKV: tuple(this.swerveDriveGains, 2)[1] ?? 0,
              driveRatio: Number(this.swerveDriveRatio),
              encoderIds: tuple4(this.swerveEncoderIds),
              encoderOffsets: tuple4(this.swerveOffsets),
              gyroId: Number(this.swerveGyroId),
              gyroMount: tuple3(this.swerveGyroMount),
              maxSpeed: Number(this.swerveMaxSpeed),
              pathRotationKP: tuple(this.swervePathGains, 2)[1] ?? 5,
              pathTranslationKP: tuple(this.swervePathGains, 2)[0] ?? 5,
              statorCurrentLimit: tuple(this.swerveCurrentLimits, 2)[0] ?? 80,
              steerIds: tuple4(this.swerveSteerIds),
              steerInverted: this.swerveSteerInverted,
              steerKD: tuple(this.swerveSteerGains, 2)[1] ?? 0,
              steerKP: tuple(this.swerveSteerGains, 2)[0] ?? 0,
              steerRatio: Number(this.swerveSteerRatio),
              supplyCurrentLimit: tuple(this.swerveCurrentLimits, 2)[1] ?? 40,
              trackwidth: tuple(this.swerveGeometry, 3)[1] ?? 0,
              wheelRadius: tuple(this.swerveGeometry, 3)[2] ?? 0,
              wheelbase: tuple(this.swerveGeometry, 3)[0] ?? 0,
            })
          : this.presetKind === 'frc.limelight'
            ? instantiateLimelightPreset(model, {
                deviceName: this.limelightDeviceName.trim(),
                pipeline: tuple(this.limelightPipelineStream, 2)[0] ?? 0,
                streamMode: tuple(this.limelightPipelineStream, 2)[1] ?? 0,
                table: this.limelightTable.trim(),
                transform: tuple6(this.limelightTransform),
              })
            : instantiateCommonPreset(model, this.presetKind as CommonPresetId, {
                canBus: this.commonPresetCanBus.trim() || 'rio',
                canId: Number(this.commonPresetCanId),
                channel: Number(this.commonPresetChannel),
                followerIds:
                  this.commonPresetFollowers.trim().length === 0
                    ? []
                    : this.commonPresetFollowers.split(',').map((entry) => Number(entry.trim())),
                name: this.commonPresetName,
                ...(this.commonPresetParentId.length === 0
                  ? {}
                  : { parentId: this.commonPresetParentId }),
                setpoints: this.commonPresetSetpoints
                  .split(',')
                  .map((entry) => entry.trim())
                  .filter(Boolean),
                setpointUnit: this.commonPresetUnit.trim(),
              });
      this.dialog('preset-dialog')?.close();
      const previousSubsystemIds = new Set(model.subsystems.map((entry) => entry.id));
      const createdSubsystem = next.subsystems.find(
        (subsystem) => !previousSubsystemIds.has(subsystem.id),
      );
      if (createdSubsystem !== undefined) this.revealEntityInTree(next, createdSubsystem.id);
      await this.previewCommand({
        changes: {
          devices: next.devices,
          presets: next.presets,
          subsystems: next.subsystems,
        },
        target: { scope: 'model' },
        type: 'update',
      });
      if (createdSubsystem !== undefined) {
        this.revealEntityInTree(next, createdSubsystem.id);
        void this.saveTreeState();
      }
    } catch (error) {
      this.showError(error);
    }
  };

  private tuningComparisons(model: FrcProjectModel): readonly TuningComparison[] {
    const live = new Map<string, LiveTuningValue>(
      (this.ntSnapshot?.values ?? []).map((entry) => [
        entry.path,
        { type: entry.type, updatedAtMillis: entry.updatedAtMillis, value: entry.value },
      ]),
    );
    return compareTuningValues(collectTuningParameters(model), live);
  }

  private readonly connectNt = async (): Promise<void> => {
    const model = this.model();
    if (model === undefined) return;
    const declarations = collectTuningParameters(model);
    const root = model.networkTables.rootPath.replace(/\/+$/gu, '');
    const prefixes = [
      root,
      '/FRCFramework/Calibration',
      ...declarations
        .map((entry) => entry.path)
        .filter((entry) => entry !== root && !entry.startsWith(`${root}/`)),
    ];
    await this.run(async () => {
      this.ntSnapshot = await window.framework.nt.connect({
        host: this.ntHost,
        prefixes: [...new Set(prefixes)],
      });
      if (this.#ntTimer !== undefined) clearInterval(this.#ntTimer);
      this.#ntTimer = setInterval(() => void this.refreshNtSnapshot(), 500);
    });
  };

  private readonly disconnectNt = async (): Promise<void> => {
    await this.run(async () => {
      if (this.#ntTimer !== undefined) clearInterval(this.#ntTimer);
      this.#ntTimer = undefined;
      this.ntSnapshot = await window.framework.nt.disconnect();
    });
  };

  private selectCalibrationEntity(entityId: string): void {
    this.activePage = 'project';
    this.treeMode = 'logic';
    this.selectedEntityId = entityId;
  }

  private readonly startCalibrationTest = async (): Promise<void> => {
    await this.run(async () => {
      this.ntSnapshot = await window.framework.nt.startCalibrationTest({
        confirmed: this.calibrationConfirmed,
        deviceId: this.calibrationDeviceId,
        durationSeconds: Number(this.calibrationDuration),
        output: Number(this.calibrationOutput),
      });
      this.calibrationConfirmed = false;
      this.notice =
        this.#i18n.locale === 'zh-CN'
          ? '低功率测试已启动并将自动停止。'
          : 'Low-power test started with automatic stop.';
    });
  };

  private readonly stopCalibrationTest = async (): Promise<void> => {
    await this.run(async () => {
      this.ntSnapshot = await window.framework.nt.stopCalibrationTest();
      this.calibrationConfirmed = false;
      this.notice =
        this.#i18n.locale === 'zh-CN' ? '校准输出已停止。' : 'Calibration output stopped.';
    });
  };

  private async refreshNtSnapshot(): Promise<void> {
    try {
      this.ntSnapshot = await window.framework.nt.snapshot();
    } catch (error) {
      if (this.#ntTimer !== undefined) clearInterval(this.#ntTimer);
      this.#ntTimer = undefined;
      this.showError(error);
    }
  }

  private selectTuning(entry: TuningComparison, selected: boolean): void {
    const next = new Set(this.ntSelected);
    if (selected) next.add(entry.parameterId);
    else next.delete(entry.parameterId);
    this.ntSelected = next;
  }

  private readonly writeNtValuesToCode = async (): Promise<void> => {
    const model = this.model();
    if (model === undefined) return;
    try {
      const command = createWriteNtValuesCommand(
        model,
        this.tuningComparisons(model),
        this.ntSelected,
      );
      this.ntSelected = new Set();
      this.pendingNtValidation = true;
      this.ntWriteValidation = 'pending';
      await this.previewCommand(command);
    } catch (error) {
      this.pendingNtValidation = false;
      this.ntWriteValidation = 'idle';
      this.showError(error);
    }
  };

  private readonly saveTuningSnapshot = async (): Promise<void> => {
    const model = this.model();
    if (model === undefined) return;
    try {
      const command = createSaveTuningSnapshotCommand(
        model,
        this.ntSnapshotName,
        this.tuningComparisons(model),
      );
      this.ntSnapshotName = '';
      await this.previewCommand(command);
    } catch (error) {
      this.showError(error);
    }
  };

  private readonly refreshToolchainInfo = async (): Promise<void> => {
    if (this.project?.model === undefined) return;
    try {
      this.toolchainInfo = await window.framework.toolchain.info();
      this.toolchainSnapshot = await window.framework.toolchain.snapshot();
    } catch (error) {
      this.showError(error);
    }
  };

  private workspaceProblems(model: FrcProjectModel): readonly WorkspaceProblem[] {
    const problems: WorkspaceProblem[] = [];
    for (const entry of validateModel(model)) {
      if (entry.code === 'duplicate-can-id') continue;
      const quickFix = this.modelQuickFix(model, entry.code, entry.entityId);
      problems.push({
        code: entry.code,
        detail: entry.path,
        ...(entry.entityId === undefined ? {} : { entityId: entry.entityId }),
        field: entry.path.split('/').at(-1) ?? entry.path,
        ...(entry.entityId === undefined
          ? {}
          : { file: this.sourceFileForEntity(model, entry.entityId) }),
        message: entry.message,
        ...(quickFix === undefined ? {} : { quickFix }),
        severity: entry.severity,
        source: 'Model',
      });
    }
    for (const entry of validateHardware(model)) {
      const quickFix = this.hardwareQuickFix(model, entry);
      problems.push({
        code: entry.code,
        detail: entry.field,
        entityId: entry.entityId,
        field: entry.field,
        file: this.sourceFileForEntity(model, entry.entityId),
        message: entry.message,
        ...(quickFix === undefined ? {} : { quickFix }),
        severity: entry.severity,
        source: 'Hardware',
      });
    }
    for (const message of this.project?.problems ?? []) {
      problems.push({
        code: 'project',
        detail: 'project.yaml / preset resources',
        message,
        severity: 'error',
        source: 'Schema / Preset',
      });
    }
    for (const file of this.project?.sourceFiles ?? []) {
      if (file.problemCount === 0) continue;
      problems.push({
        code: 'java-parse',
        detail: `${String(file.problemCount)} parser problem(s)`,
        file: file.path,
        message:
          'Java source could not be indexed completely; inspect it in the configured editor.',
        severity: 'warning',
        source: 'Java parser',
      });
    }
    for (const entry of this.toolchainSnapshot?.active?.diagnostics ?? []) {
      problems.push({
        code: 'build',
        ...(entry.column === undefined ? {} : { column: entry.column }),
        detail: `${entry.file ?? ''}${entry.line === undefined ? '' : `:${String(entry.line)}`}`,
        ...(entry.file === undefined ? {} : { file: entry.file }),
        ...(entry.line === undefined ? {} : { line: entry.line }),
        message: entry.message,
        severity: entry.severity,
        source: 'Gradle',
      });
    }
    if (this.ntWriteValidation === 'failed') {
      problems.push({
        code: 'nt-validation',
        detail: 'NT write-back validation',
        message: 'Generated tuning defaults did not pass format/compile validation.',
        severity: 'error',
        source: 'NetworkTables',
      });
    }
    const deduplicated = new Map<string, WorkspaceProblem>();
    for (const problem of problems) {
      const key = [
        problem.code,
        problem.entityId ?? '',
        problem.file ?? '',
        problem.line ?? '',
        problem.field ?? '',
        problem.message,
      ].join('|');
      deduplicated.set(key, problem);
    }
    return [...deduplicated.values()].sort(
      (left, right) =>
        Number(right.severity === 'error') - Number(left.severity === 'error') ||
        left.source.localeCompare(right.source) ||
        left.message.localeCompare(right.message),
    );
  }

  private modelQuickFix(
    model: FrcProjectModel,
    code: string,
    entityId: string | undefined,
  ): WorkspaceQuickFix | undefined {
    if (code !== 'duplicate-usb-port' || entityId === undefined) return undefined;
    const controller = model.controllers.find((entry) => entry.id === entityId);
    const used = new Set(
      model.controllers.filter((entry) => entry.id !== entityId).map((entry) => entry.port),
    );
    const port = [0, 1, 2, 3, 4, 5].find((candidate) => !used.has(candidate));
    if (controller === undefined || port === undefined) return undefined;
    return {
      command: {
        changes: { port },
        target: { collection: 'controllers', id: controller.id, scope: 'entity' },
        type: 'update',
      },
      label: `${this.#i18n.locale === 'zh-CN' ? '改为 USB' : 'Use USB'} ${String(port)}`,
    };
  }

  private hardwareQuickFix(
    model: FrcProjectModel,
    problem: ReturnType<typeof validateHardware>[number],
  ): WorkspaceQuickFix | undefined {
    const device = model.devices.find((entry) => entry.id === problem.entityId);
    if (device === undefined) return undefined;
    if (problem.quickFix !== undefined && problem.field.startsWith('parameters.')) {
      const key = problem.field.split('.')[1];
      if (key === undefined) return undefined;
      return {
        command: {
          changes: {
            parameters: device.parameters.map((parameter) =>
              parameter.key === key
                ? {
                    ...parameter,
                    source: 'user' as const,
                    value: problem.quickFix?.value ?? parameter.value,
                  }
                : parameter,
            ),
          },
          target: { collection: 'devices', id: device.id, scope: 'entity' },
          type: 'update',
        },
        label: problem.quickFix.label,
      };
    }
    if (problem.code !== 'port-conflict') return undefined;
    if (device.canId !== undefined) {
      const used = new Set(
        model.devices
          .filter(
            (entry) =>
              entry.id !== device.id && (entry.canBus ?? 'rio') === (device.canBus ?? 'rio'),
          )
          .map((entry) => entry.canId)
          .filter((value): value is number => value !== undefined),
      );
      const canId = Array.from({ length: 63 }, (_, index) => index).find(
        (candidate) => !used.has(candidate),
      );
      if (canId === undefined) return undefined;
      return {
        command: {
          changes: { canId },
          target: { collection: 'devices', id: device.id, scope: 'entity' },
          type: 'update',
        },
        label: `${this.#i18n.locale === 'zh-CN' ? '改为 CAN' : 'Use CAN'} ${String(canId)}`,
      };
    }
    return undefined;
  }

  private sourceFileForEntity(model: FrcProjectModel, entityId: string): string | undefined {
    const packagePath = model.project.javaPackage.replace(/\./gu, '/');
    const subsystemById = new Map(model.subsystems.map((entry) => [entry.id, entry]));
    let subsystem = subsystemById.get(entityId);
    const device = model.devices.find((entry) => entry.id === entityId);
    subsystem ??= device === undefined ? undefined : subsystemById.get(device.parentId);
    while (subsystem?.parentId !== undefined) subsystem = subsystemById.get(subsystem.parentId);
    if (subsystem !== undefined) {
      const packageName =
        subsystem.javaPackage ??
        `${model.project.javaPackage}.subsystems.${lowerFirst(subsystem.symbol)}`;
      return (
        subsystem.javaFile ??
        `src/main/java/${packageName.replace(/\./gu, '/')}/${subsystem.symbol}.java`
      );
    }
    if (
      model.controllers.some((entry) => entry.id === entityId) ||
      model.bindings.some((entry) => entry.id === entityId)
    )
      return `src/main/java/${packagePath}/controls/OperatorInterface.java`;
    const command = model.commands.find((entry) => entry.id === entityId);
    if (command !== undefined)
      return command.javaFile ?? `src/main/java/${packagePath}/commands/RobotCommands.java`;
    if (model.autos.some((entry) => entry.id === entityId))
      return `src/main/java/${packagePath}/auto/AutoRoutines.java`;
    return undefined;
  }

  private async exportDiagnosticReport(problems: readonly WorkspaceProblem[]): Promise<void> {
    const model = this.model();
    if (model === undefined) return;
    const report = `# FRC Framework diagnostics

- Project: ${model.project.displayName}
- Team: ${String(model.project.teamNumber)}
- WPILib: ${String(model.project.wpilibYear)}
- Schema/Base: ${String(model.schemaVersion)}/${String(model.project.baseVersion)}
- Generated: ${new Date().toISOString()}

## Problems (${String(problems.length)})

${problems.length === 0 ? 'No problems detected.' : problems.map((problem) => `- **${problem.severity.toUpperCase()}** [${problem.source}] ${problem.message} (${problem.detail})`).join('\n')}

## Toolchain

- Java: ${this.toolchainInfo?.selected?.executable ?? 'not selected'}
- Last task: ${this.toolchainSnapshot?.active?.task ?? 'none'} / ${this.toolchainSnapshot?.active?.state ?? 'idle'}
`;
    await this.run(async () => {
      const filePath = await window.framework.diagnostics.exportReport(report);
      if (filePath !== undefined) this.notice = filePath;
    });
  }

  private openWorkspaceProblem(problem: WorkspaceProblem): void {
    if (problem.entityId !== undefined) {
      this.activePage = 'project';
      this.treeMode = 'logic';
      this.selectedEntityId = problem.entityId;
      void this.updateComplete.then(() => {
        if (problem.field === undefined) return;
        const field = this.renderRoot.querySelector<HTMLElement>(
          `[data-field="${CSS.escape(problem.field)}"]`,
        );
        field?.scrollIntoView({ block: 'center' });
        field?.focus();
      });
    } else if (problem.file !== undefined) {
      void this.openSourceFile(problem.file, problem.line ?? 1, problem.column);
    }
  }

  private async startToolchainTask(task: ToolchainTask, confirmed: boolean): Promise<void> {
    await this.run(async () => {
      this.toolchainSnapshot = await window.framework.toolchain.start(task, confirmed);
      if (this.#toolchainTimer !== undefined) clearInterval(this.#toolchainTimer);
      this.#toolchainTimer = setInterval(() => void this.refreshToolchainSnapshot(), 400);
      this.notice = `${task} running`;
    });
  }

  private async refreshToolchainSnapshot(): Promise<void> {
    try {
      this.toolchainSnapshot = await window.framework.toolchain.snapshot();
      const active = this.toolchainSnapshot.active;
      if (active !== undefined && active.state !== 'running') {
        if (this.#toolchainTimer !== undefined) clearInterval(this.#toolchainTimer);
        this.#toolchainTimer = undefined;
        this.notice = `${active.task}: ${active.state}`;
        this.noticeError = active.state === 'failed';
        if (active.task === 'validate') {
          this.ntWriteValidation = active.state === 'success' ? 'success' : 'failed';
        }
      }
    } catch (error) {
      if (this.#toolchainTimer !== undefined) clearInterval(this.#toolchainTimer);
      this.#toolchainTimer = undefined;
      this.showError(error);
    }
  }

  private readonly cancelToolchainTask = async (): Promise<void> => {
    this.toolchainSnapshot = await window.framework.toolchain.cancel();
  };

  private readonly confirmDeploy = async (): Promise<void> => {
    this.dialog('deploy-dialog')?.close();
    await this.startToolchainTask('deploy', true);
  };

  private readonly openDeployDialog = async (): Promise<void> => {
    await this.refreshToolchainInfo();
    this.dialog('deploy-dialog')?.show();
  };

  private readonly launchExternal = async (
    tool: 'advantagescope' | 'pathplanner',
  ): Promise<void> => {
    await this.run(async () => window.framework.external.launch(tool));
  };

  private async loadDocSupplement(filePath: string): Promise<void> {
    await this.run(async () => {
      this.docSupplement = await window.framework.project.readDocSupplement(filePath);
      this.selectedDocPath = filePath;
    });
  }

  private readonly saveDocSupplement = async (): Promise<void> => {
    if (this.selectedDocPath === undefined) return;
    await this.run(async () => {
      this.preview = await window.framework.project.previewDocSupplement({
        markdown: this.docSupplement,
        path: this.selectedDocPath ?? '',
      });
      this.notice = this.#i18n.t('diff.pending');
    });
  };

  private readonly addSubsystem = async (): Promise<void> => {
    const model = this.model();
    const name = this.subsystemName.trim();
    if (model === undefined || name.length === 0) return;
    const symbol = javaSymbol(name);
    const parent =
      this.subsystemParentId.length === 0
        ? undefined
        : model.subsystems.find((entry) => entry.id === this.subsystemParentId);
    if (
      this.subsystemParentId.length > 0 &&
      (parent === undefined || this.isSubsystemSourceReadOnly(model, parent))
    )
      return;
    const id = createEntityId();
    const entity: Subsystem = {
      behaviorMode: this.subsystemBehavior,
      displayName: name,
      id,
      kind: this.subsystemKind,
      ...(parent === undefined ? {} : { parentId: parent.id }),
      realImplementation: this.subsystemReal,
      simulationImplementation: this.subsystemSim,
      ...(this.subsystemBehavior === 'goal-driven'
        ? {
            advantageKitLogging: false,
            generateGoalCommand: true,
            stateMachine: {
              states: [
                {
                  actions: [],
                  displayName: 'Idle',
                  id: createEntityId(),
                  initial: true,
                  symbol: 'Idle',
                },
              ],
              transitions: [],
            },
          }
        : {}),
      symbol,
    };
    this.dialog('subsystem-dialog')?.close();
    this.revealEntityInTree({ ...model, subsystems: [...model.subsystems, entity] }, id);
    await this.previewCommand({ collection: 'subsystems', entity, type: 'add' });
  };

  private readonly addMechanism = async (): Promise<void> => {
    const parent = this.model()?.subsystems.find((entry) => entry.id === this.mechanismParentId);
    const name = this.mechanismName.trim();
    const model = this.model();
    if (
      parent === undefined ||
      model === undefined ||
      this.isSubsystemSourceReadOnly(model, parent) ||
      name.length === 0
    )
      return;
    const id = createEntityId();
    this.dialog('mechanism-dialog')?.close();
    this.revealEntityInTree(
      {
        ...model,
        subsystems: [
          ...model.subsystems,
          {
            behaviorMode: 'direct',
            displayName: name,
            id,
            kind: 'mechanism',
            parentId: parent.id,
            symbol: javaSymbol(name),
          },
        ],
      },
      id,
    );
    await this.previewCommand({
      collection: 'subsystems',
      entity: {
        behaviorMode: 'direct',
        displayName: name,
        id,
        kind: 'mechanism',
        ...(this.mechanismNotes.trim().length === 0 ? {} : { notes: this.mechanismNotes.trim() }),
        parentId: parent.id,
        symbol: javaSymbol(name),
      },
      type: 'add',
    });
  };

  private readonly addDevice = async (): Promise<void> => {
    const parent = this.selectedSubsystem();
    const model = this.model();
    const definition = findComponentDefinition(this.deviceCatalogId);
    const name = this.deviceName.trim();
    if (
      parent === undefined ||
      model === undefined ||
      this.isSubsystemSourceReadOnly(model, parent) ||
      definition === undefined ||
      name.length === 0
    )
      return;
    const canDevice = ['motor', 'encoder', 'gyro'].includes(definition.domainKind);
    const values: Record<string, string | number | boolean> = {};
    if (!canDevice && definition.role !== 'mechanism') values.channel = Number(this.deviceCanId);
    if (definition.role === 'follower') {
      values.leaderId = this.deviceLeaderId;
      values.opposeLeader = this.deviceOpposeLeader;
    }
    const device = instantiateCatalogDevice({
      ...(canDevice
        ? { canBus: this.deviceCanBus.trim() || 'rio', canId: Number(this.deviceCanId) }
        : {}),
      componentId: definition.id,
      displayName: name,
      parentId: parent.id,
      values,
    });
    this.dialog('device-dialog')?.close();
    this.revealEntityInTree({ ...model, devices: [...model.devices, device] }, device.id);
    await this.previewCommand({ collection: 'devices', entity: device, type: 'add' });
  };

  private readonly addGoal = async (): Promise<void> => {
    const subsystem = this.selectedSubsystem();
    const model = this.model();
    const name = this.goalName.trim();
    if (
      subsystem === undefined ||
      model === undefined ||
      this.isSubsystemSourceReadOnly(model, subsystem) ||
      name.length === 0
    )
      return;
    const stateMachine = subsystem.stateMachine ?? { states: [], transitions: [] };
    this.dialog('goal-dialog')?.close();
    this.revealEntityInTree(model, subsystem.id);
    await this.previewCommand({
      changes: {
        behaviorMode: 'goal-driven',
        stateMachine: {
          ...stateMachine,
          states: [
            ...stateMachine.states,
            {
              actions: [],
              displayName: name,
              id: createEntityId(),
              initial: stateMachine.states.length === 0,
              symbol: javaSymbol(name),
            },
          ],
        },
      },
      target: { collection: 'subsystems', id: subsystem.id, scope: 'entity' },
      type: 'update',
    });
  };

  private async removeGoal(subsystem: Subsystem, stateId: string): Promise<void> {
    const model = this.model();
    if (model === undefined || this.isSubsystemSourceReadOnly(model, subsystem)) return;
    const updated = removeSubsystemState(subsystem, stateId);
    await this.previewCommand({
      changes: { stateMachine: updated.stateMachine },
      target: { collection: 'subsystems', id: subsystem.id, scope: 'entity' },
      type: 'update',
    });
  }

  private readonly createController = async (): Promise<void> => {
    const name = this.controllerName.trim();
    if (name.length === 0) return;
    this.dialog('controller-dialog')?.close();
    await this.previewCommand({
      collection: 'controllers',
      entity: {
        axisScale: 1,
        deadband: 0.1,
        displayName: name,
        id: createEntityId(),
        port: Number(this.controllerPort),
        provider: this.controllerProvider,
        role: this.controllerRole,
        rumbleEnabled: true,
        ...(this.controllerLayout.trim().length === 0
          ? {}
          : { parameters: { layout: this.controllerLayout.trim() } }),
        symbol: `${javaSymbol(name).slice(0, 1).toLowerCase()}${javaSymbol(name).slice(1)}`,
      },
      type: 'add',
    });
  };

  private readonly addCommand = async (): Promise<void> => {
    const name = this.commandName.trim();
    if (name.length === 0) return;
    this.dialog('command-editor-dialog')?.close();
    await this.previewCommand({
      collection: 'commands',
      entity: {
        ...(this.commandExpression.trim().length === 0
          ? {}
          : { codeExpression: this.commandExpression.trim() }),
        displayName: name,
        factory: this.commandFactory,
        id: createEntityId(),
        kind: this.commandKind,
        ...(this.commandPathplannerName.trim().length === 0
          ? {}
          : { pathplannerName: this.commandPathplannerName.trim() }),
        requirementIds: this.commandRequirementId.length === 0 ? [] : [this.commandRequirementId],
        symbol: `${javaSymbol(name).slice(0, 1).toLowerCase()}${javaSymbol(name).slice(1)}`,
      },
      type: 'add',
    });
  };

  private readonly addBinding = async (): Promise<void> => {
    if (
      this.bindingControllerId.length === 0 ||
      this.bindingCommandId.length === 0 ||
      this.bindingInput.trim().length === 0
    )
      return;
    this.dialog('binding-dialog')?.close();
    await this.previewCommand({
      collection: 'bindings',
      entity: {
        behavior: this.bindingBehavior,
        commandId: this.bindingCommandId,
        controllerId: this.bindingControllerId,
        id: createEntityId(),
        input: this.bindingInput.trim(),
      },
      type: 'add',
    });
  };

  private readonly addAutoRoutine = async (): Promise<void> => {
    const name = this.autoName.trim();
    if (name.length === 0 || this.autoCommandId.length === 0) return;
    const pathFiles = this.autoPathFiles
      .split(',')
      .map((entry) => entry.trim().replace(/\\/gu, '/'))
      .filter(Boolean);
    this.dialog('auto-dialog')?.close();
    await this.previewCommand({
      collection: 'autos',
      entity: {
        commandId: this.autoCommandId,
        displayName: name,
        id: createEntityId(),
        pathFiles,
        symbol: javaSymbol(name, 'auto'),
      },
      type: 'add',
    });
  };

  private async renameSelected(displayName: string, symbol: string): Promise<void> {
    const selected = this.selectedEntity();
    const model = this.model();
    if (
      selected === undefined ||
      model === undefined ||
      this.isEntitySourceReadOnly(model, selected)
    )
      return;
    await this.previewCommand({
      collection: 'parameters' in selected ? 'devices' : 'subsystems',
      displayName,
      id: selected.id,
      symbol,
      type: 'rename',
    });
  }

  private async moveSubsystemToParent(
    subsystem: Subsystem,
    parentId: string | undefined,
  ): Promise<void> {
    const model = this.model();
    if (
      model === undefined ||
      subsystem.parentId === parentId ||
      !subsystemUsesAutomaticJavaLocation(model, subsystem) ||
      this.isSubsystemSourceReadOnly(model, subsystem) ||
      (parentId !== undefined && !this.canReparent(subsystem.id, parentId))
    )
      return;
    await this.previewCommand({
      changes: { parentId },
      target: { collection: 'subsystems', id: subsystem.id, scope: 'entity' },
      type: 'update',
    });
  }

  private async moveDeviceToParent(device: Device, parentId: string): Promise<void> {
    const model = this.model();
    if (
      model === undefined ||
      parentId.length === 0 ||
      device.parentId === parentId ||
      !this.canReparent(device.id, parentId)
    )
      return;
    await this.previewCommand({
      changes: { parentId },
      target: { collection: 'devices', id: device.id, scope: 'entity' },
      type: 'update',
    });
  }

  private async changeSubsystemBehavior(
    subsystem: Subsystem,
    behaviorMode: NonNullable<Subsystem['behaviorMode']>,
  ): Promise<void> {
    const model = this.model();
    if (model === undefined || this.isSubsystemSourceReadOnly(model, subsystem)) return;
    const stateMachine =
      behaviorMode === 'goal-driven'
        ? (subsystem.stateMachine ?? {
            states: [
              {
                actions: [],
                displayName: 'Idle',
                id: createEntityId(),
                initial: true,
                symbol: 'Idle',
              },
            ],
            transitions: [],
          })
        : undefined;
    await this.previewCommand({
      changes: {
        behaviorMode,
        stateMachine,
        ...(behaviorMode === 'goal-driven' && subsystem.generateGoalCommand === undefined
          ? { generateGoalCommand: true }
          : {}),
      },
      target: { collection: 'subsystems', id: subsystem.id, scope: 'entity' },
      type: 'update',
    });
  }

  private async updateSubsystemScaffold(
    subsystem: Subsystem,
    changes: Pick<Subsystem, 'generateGoalCommand' | 'advantageKitLogging'>,
  ): Promise<void> {
    const model = this.model();
    if (model === undefined || this.isSubsystemSourceReadOnly(model, subsystem)) return;
    await this.previewCommand({
      changes,
      target: { collection: 'subsystems', id: subsystem.id, scope: 'entity' },
      type: 'update',
    });
  }

  private async updateRobotTelemetry(
    model: FrcProjectModel,
    key: 'fieldPublisher' | 'stateRecorder',
    value: boolean,
  ): Promise<void> {
    await this.previewCommand({
      changes: {
        telemetry: {
          fieldPublisher: model.robot.telemetry?.fieldPublisher !== false,
          stateRecorder: model.robot.telemetry?.stateRecorder !== false,
          [key]: value,
        },
      },
      target: { scope: 'robot' },
      type: 'update',
    });
  }

  private async updateParameter(
    device: Device,
    key: string,
    value: Device['parameters'][number]['value'],
  ): Promise<void> {
    const model = this.model();
    if (model === undefined || this.isEntitySourceReadOnly(model, device)) return;
    const parameters = device.parameters.map((parameter) =>
      parameter.key === key ? { ...parameter, source: 'user' as const, value } : parameter,
    );
    await this.previewCommand({
      changes: { parameters },
      target: { collection: 'devices', id: device.id, scope: 'entity' },
      type: 'update',
    });
  }

  private async removeOptionalParameter(device: Device, key: string): Promise<void> {
    const model = this.model();
    if (model === undefined || this.isEntitySourceReadOnly(model, device)) return;
    const definition =
      device.catalogId === undefined ? undefined : findComponentDefinition(device.catalogId);
    if (definition?.parameters.find((parameter) => parameter.key === key)?.required === true)
      return;
    await this.previewCommand({
      changes: { parameters: device.parameters.filter((parameter) => parameter.key !== key) },
      target: { collection: 'devices', id: device.id, scope: 'entity' },
      type: 'update',
    });
  }

  private async toggleParameterNt(device: Device, key: string): Promise<void> {
    const model = this.model();
    if (model === undefined || this.isEntitySourceReadOnly(model, device)) return;
    const parameters = device.parameters.map((parameter) =>
      parameter.key === key
        ? {
            ...parameter,
            networkTables: {
              ...parameter.networkTables,
              // An omitted binding is enabled by default in the Inspector, so
              // the first click must explicitly disable it.
              enabled: parameter.networkTables?.enabled === false,
              writable: parameter.networkTables?.writable ?? true,
            },
          }
        : parameter,
    );
    await this.previewCommand({
      changes: { parameters },
      target: { collection: 'devices', id: device.id, scope: 'entity' },
      type: 'update',
    });
  }

  private async addOptionalParameter(device: Device, key: string): Promise<void> {
    const model = this.model();
    if (model === undefined || this.isEntitySourceReadOnly(model, device)) return;
    const definition =
      device.catalogId === undefined ? undefined : findComponentDefinition(device.catalogId);
    const catalogParameter = definition?.parameters.find((parameter) => parameter.key === key);
    if (catalogParameter === undefined) return;
    const parameters = [
      ...device.parameters,
      {
        ...(catalogParameter.condition === undefined
          ? {}
          : { condition: catalogParameter.condition }),
        ...(catalogParameter.enumValues === undefined
          ? {}
          : { enumValues: catalogParameter.enumValues }),
        ...(catalogParameter.maximum === undefined ? {} : { maximum: catalogParameter.maximum }),
        ...(catalogParameter.minimum === undefined ? {} : { minimum: catalogParameter.minimum }),
        ...(catalogParameter.unit === undefined ? {} : { unit: catalogParameter.unit }),
        defaultValue: catalogParameter.defaultValue,
        description: catalogParameter.description,
        displayName: catalogParameter.displayName,
        id: createEntityId(),
        key: catalogParameter.key,
        networkTables: { enabled: true, writable: true },
        source: 'default' as const,
        type: catalogParameter.type,
        value: catalogParameter.defaultValue,
      },
    ];
    await this.previewCommand({
      changes: { parameters },
      target: { collection: 'devices', id: device.id, scope: 'entity' },
      type: 'update',
    });
  }

  private async addSubsystemReference(subsystem: Subsystem, targetId: string): Promise<void> {
    const model = this.model();
    const target = model?.subsystems.find((entry) => entry.id === targetId);
    if (
      model === undefined ||
      target === undefined ||
      this.isSubsystemSourceReadOnly(model, subsystem)
    )
      return;
    const dependencies = [
      ...(subsystem.dependencies ?? []).filter(
        (dependency) => dependency.targetSubsystemId !== targetId,
      ),
      {
        fieldName: `${target.symbol.slice(0, 1).toLowerCase()}${target.symbol.slice(1)}`,
        targetSubsystemId: targetId,
      },
    ];
    await this.previewCommand({
      changes: { dependencies },
      target: { collection: 'subsystems', id: subsystem.id, scope: 'entity' },
      type: 'update',
    });
  }

  private async removeSubsystemReference(
    subsystem: Subsystem,
    targetSubsystemId: string,
  ): Promise<void> {
    const model = this.model();
    if (model === undefined || this.isSubsystemSourceReadOnly(model, subsystem)) return;
    await this.previewCommand({
      changes: {
        dependencies: (subsystem.dependencies ?? []).filter(
          (dependency) => dependency.targetSubsystemId !== targetSubsystemId,
        ),
      },
      target: { collection: 'subsystems', id: subsystem.id, scope: 'entity' },
      type: 'update',
    });
  }

  private async removeCollectionEntity(
    collection: 'autos' | 'bindings',
    id: string,
  ): Promise<void> {
    await this.previewCommand({ collection, id, type: 'remove' });
  }

  private async removeControllerEntity(controllerId: string): Promise<void> {
    const model = this.model();
    if (model === undefined) return;
    await this.previewCommand({
      changes: {
        bindings: model.bindings.filter((binding) => binding.controllerId !== controllerId),
        controllers: model.controllers.filter((controller) => controller.id !== controllerId),
      },
      target: { scope: 'model' },
      type: 'update',
    });
  }

  private async removeCommand(commandId: string): Promise<void> {
    const model = this.model();
    if (model === undefined) return;
    const command = model.commands.find((entry) => entry.id === commandId);
    if (this.isUnmanagedPath(model, command?.javaFile)) {
      this.notice = this.#i18n.t('structured.importedReadOnlyHint');
      return;
    }
    await this.previewCommand({
      changes: {
        autos: model.autos.filter((auto) => auto.commandId !== commandId),
        bindings: model.bindings.filter((binding) => binding.commandId !== commandId),
        commands: model.commands
          .filter((command) => command.id !== commandId)
          .map((command) => ({
            ...command,
            ...(command.childCommandIds === undefined
              ? {}
              : {
                  childCommandIds: command.childCommandIds.filter(
                    (childId) => childId !== commandId,
                  ),
                }),
          })),
        subsystems: model.subsystems.map((subsystem) => ({
          ...subsystem,
          ...(subsystem.stateMachine === undefined
            ? {}
            : {
                stateMachine: {
                  ...subsystem.stateMachine,
                  states: subsystem.stateMachine.states.map((state) => ({
                    ...state,
                    actions: state.actions.filter((action) => action.commandId !== commandId),
                  })),
                },
              }),
        })),
      },
      target: { scope: 'model' },
      type: 'update',
    });
  }

  private prepareSubsystemReference(subsystem: Subsystem, targetId: string): void {
    const model = this.model();
    const target = model?.subsystems.find((entry) => entry.id === targetId);
    if (model === undefined || target === undefined) return;
    const graph = model.subsystems
      .filter((entry) => entry.parentId === undefined)
      .flatMap((entry) =>
        (entry.dependencies ?? []).map((dependency) => {
          const dependencyTarget = model.subsystems.find(
            (candidate) => candidate.id === dependency.targetSubsystemId,
          );
          return `${entry.displayName} → ${dependencyTarget?.displayName ?? '?'}`;
        }),
      );
    graph.push(`${subsystem.displayName} → ${target.displayName}`);
    const packageName =
      subsystem.javaPackage ??
      `${model.project.javaPackage}.subsystems.${lowerFirst(subsystem.symbol)}`;
    this.referenceImpact = {
      files: [
        'project.yaml',
        subsystem.javaFile ??
          `src/main/java/${packageName.replace(/\./gu, '/')}/${subsystem.symbol}.java`,
        `src/main/java/${model.project.javaPackage.replace(/\./gu, '/')}/RobotContainer.java`,
        'docs/SUBSYSTEMS.md',
      ],
      graph,
      sourceId: subsystem.id,
      targetId,
    };
    if (!this.settings.previewChanges) {
      this.referenceImpact = undefined;
      void this.addSubsystemReference(subsystem, targetId);
      return;
    }
    this.dialog('reference-impact-dialog')?.show();
  }

  private readonly confirmSubsystemReference = async (): Promise<void> => {
    const impact = this.referenceImpact;
    const subsystem = this.model()?.subsystems.find((entry) => entry.id === impact?.sourceId);
    if (impact === undefined || subsystem === undefined) return;
    this.dialog('reference-impact-dialog')?.close();
    this.referenceImpact = undefined;
    await this.addSubsystemReference(subsystem, impact.targetId);
  };

  private async resolveExternalChanges(action: ExternalConflictAction): Promise<void> {
    const paths = this.externalChanges.map((event) => event.path);
    if (paths.length === 0) return;
    this.dialog('external-change-dialog')?.close();
    await this.run(async () => {
      const result = await window.framework.project.resolveExternal({ action, paths });
      if (result.project !== undefined) {
        this.project = result.project;
        this.restoreTreeState(result.project);
      }
      if (result.preview !== undefined) {
        this.preview = result.preview;
        this.previewSelectionId = this.selectedEntityId;
      }
      this.externalChanges = [];
      this.notice =
        result.preview === undefined
          ? this.#i18n.locale === 'zh-CN'
            ? '已从磁盘重新载入。'
            : 'Reloaded from disk.'
          : this.#i18n.t('diff.pending');
    });
  }

  private async previewCommand(command: DomainCommand): Promise<void> {
    if (this.preview !== undefined) {
      this.selectedEntityId = this.previewSelectionId;
      this.notice = this.#i18n.t('diff.resolvePending');
      return;
    }
    await this.run(async () => {
      const preview = await window.framework.project.previewCommand(command);
      this.preview = preview;
      this.previewSelectionId = this.selectedEntityId;
      this.notice = `${preview.changes.filter((change) => change.kind !== 'unchanged').length} ${this.#i18n.t('diff.files')}`;
      if (
        preview.problems.length === 0 &&
        (!this.settings.previewChanges ||
          (this.settings.autoApplySafeChanges && preview.safeToApply))
      ) {
        await this.applyPreview();
      }
    });
  }

  private readonly applyPreview = async (): Promise<void> => {
    const preview = this.preview;
    if (preview === undefined) return;
    const validateNtWrite = this.pendingNtValidation;
    const selectedEntityId = this.selectedEntityId;
    await this.run(async () => {
      this.project = await window.framework.project.applyPreview(preview.id);
      this.restoreTreeState(this.project);
      this.selectedEntityId = selectedEntityId;
      this.preview = undefined;
      this.previewSelectionId = undefined;
      this.notice = this.project.path;
      this.requestUpdate();
    });
    if (validateNtWrite) {
      this.pendingNtValidation = false;
      this.ntWriteValidation = 'running';
      await this.startToolchainTask('validate', false);
    }
  };

  private readonly confirmSourceImport = async (): Promise<void> => {
    await this.run(async () => {
      this.preview = await window.framework.project.confirmSourceImport();
      this.previewSelectionId = this.selectedEntityId;
      this.notice = this.#i18n.t('structured.importSummary');
    });
  };

  private readonly discardPreview = async (): Promise<void> => {
    const preview = this.preview;
    if (preview === undefined) return;
    await this.run(async () => {
      await window.framework.project.discardPreview(preview.id);
      this.preview = undefined;
      this.previewSelectionId = undefined;
      if (this.pendingNtValidation) {
        this.pendingNtValidation = false;
        this.ntWriteValidation = 'idle';
      }
      this.selectedEntityId = undefined;
    });
  };

  private parameterText(value: Device['parameters'][number]['value']): string {
    return Array.isArray(value) ? value.join(', ') : String(value);
  }

  private parameterDescription(
    parameter: Device['parameters'][number],
    catalogParameter: CatalogParameterDefinition | undefined,
  ): string {
    const english = parameter.description ?? catalogParameter?.description ?? parameter.displayName;
    if (this.#i18n.locale !== 'zh-CN') return english;
    if (/^k[PIDSVGAF]$/u.test(parameter.key)) {
      return `${parameter.key} 闭环增益；调节时应同时观察响应、超调和电流。`;
    }
    const known = CHINESE_PARAMETER_DESCRIPTIONS[parameter.key];
    if (known !== undefined) return known;
    const category = CHINESE_PARAMETER_CATEGORIES[catalogParameter?.category ?? 'identity'];
    return `用于配置设备的${category}行为：${parameter.displayName}。`;
  }

  private parseParameterValue(
    type: Device['parameters'][number]['type'],
    value: string,
  ): Device['parameters'][number]['value'] {
    if (type === 'number') return Number(value);
    if (type === 'number[]') return value.split(',').map((entry) => Number(entry.trim()));
    if (type === 'string[]')
      return value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
    if (type === 'boolean') return value === 'true';
    return value;
  }

  private readonly addJavaImport = async (): Promise<void> => {
    const file = this.selectedSourcePath;
    const importName = this.importName.trim();
    if (file === undefined || importName.length === 0) return;
    await this.run(async () => {
      this.preview = await window.framework.project.addImport({
        file,
        importName,
        isStatic: this.importStatic,
      });
      this.notice = this.#i18n.t('diff.pending');
    });
  };

  private async openSourceFile(relativePath: string, line = 1, column?: number): Promise<void> {
    const project = this.project;
    const overrideId = this.projectEditorId();
    const editor =
      overrideId.length === 0
        ? this.settings.editor
        : this.availableEditors().find((candidate) => candidate.id === overrideId);
    if (project === undefined || editor === undefined || relativePath.length === 0) {
      this.openSettings();
      return;
    }
    await this.run(async () => {
      const file = /^(?:[A-Za-z]:[\\/]|\/)/u.test(relativePath)
        ? relativePath
        : `${project.path}/${relativePath}`;
      await window.framework.editor.open(editor, {
        file,
        line,
        ...(column === undefined ? {} : { column }),
        project: project.path,
      });
    });
  }

  private readonly setTreeMode = (mode: 'logic' | 'source'): void => {
    if (mode !== this.treeMode) this.treeSearch = '';
    this.treeMode = mode;
    this.treeRowLimit = 250;
    void this.saveTreeState();
  };

  private toggleSourceDirectory(directory: string): void {
    const next = new Set(this.expandedSourcePaths);
    if (next.has(directory)) next.delete(directory);
    else next.add(directory);
    this.expandedSourcePaths = next;
    void this.saveTreeState();
  }

  private sourceFileIcon(file: ProjectSourceFile): string {
    if (file.binary) return file.kind === 'asset' ? 'view_in_ar' : 'data_object';
    return (
      {
        asset: 'image',
        configuration: 'settings',
        cpp: 'code',
        documentation: 'description',
        gradle: 'build',
        java: 'coffee',
        kotlin: 'code',
        log: 'monitoring',
        pathplanner: 'route',
        script: 'terminal',
        text: 'article',
      } satisfies Record<ProjectSourceFile['kind'], string>
    )[file.kind];
  }

  private toggleTreeNode(id: string): void {
    const next = new Set(this.expandedEntityIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expandedEntityIds = next;
    void this.saveTreeState();
  }

  private restoreTreeState(project: ProjectOpenResult): void {
    const saved = this.settings.projectUi[project.path];
    this.treeMode = project.sourceBrowseOnly === true ? 'source' : (saved?.treeMode ?? 'logic');
    this.expandedEntityIds = new Set(
      saved?.expandedEntityIds ?? [
        ...(project.model === undefined ? [] : [project.model.robot.id]),
        ...(project.model?.subsystems
          .filter((entry) => entry.parentId === undefined)
          .map((entry) => entry.id) ?? []),
      ],
    );
    this.expandedSourcePaths = new Set(
      saved?.expandedSourcePaths ?? defaultExpandedSourcePaths(project.sourceFiles),
    );
    if (
      this.selectedSourcePath !== undefined &&
      !project.sourceFiles.some((file) => file.path === this.selectedSourcePath)
    ) {
      this.selectedSourcePath = undefined;
    }
  }

  private async saveTreeState(): Promise<void> {
    const projectPath = this.project?.path;
    if (projectPath === undefined) return;
    this.settings = await window.framework.settings.update({
      projectUi: {
        ...this.settings.projectUi,
        [projectPath]: {
          expandedEntityIds: [...this.expandedEntityIds].sort(),
          expandedSourcePaths: [...this.expandedSourcePaths].sort(),
          treeMode: this.treeMode,
        },
      },
    });
  }

  private openTreeMenu(event: Event, entityId: string): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectedEntityId = entityId;
    const menu = this.renderRoot.querySelector('#tree-actions-menu') as
      (HTMLElement & { anchorElement: HTMLElement; open: boolean }) | null;
    if (menu === null || !(event.currentTarget instanceof HTMLElement)) return;
    menu.anchorElement = event.currentTarget;
    menu.open = true;
  }

  private readonly openSelectedEntityCode = async (): Promise<void> => {
    const model = this.model();
    const selected = this.selectedEntity();
    if (model === undefined || selected === undefined) return;
    const owner =
      'parameters' in selected
        ? model.subsystems.find((entry) => entry.id === selected.parentId)
        : selected;
    if (owner === undefined) return;
    await this.openSourceFile(subsystemJavaLocation(model, owner).file);
  };

  private readonly prepareDeleteSelected = (): void => {
    const model = this.model();
    const device = model?.devices.find((entry) => entry.id === this.selectedEntityId);
    const subsystem = model?.subsystems.find((entry) => entry.id === this.selectedEntityId);
    if (model === undefined || (device === undefined && subsystem === undefined)) {
      this.notice = this.#i18n.t('tree.deleteDeviceOnly');
      return;
    }
    const selected = subsystem ?? device;
    if (selected !== undefined && this.isEntitySourceReadOnly(model, selected)) {
      this.notice = this.#i18n.t('structured.importedReadOnlyHint');
      return;
    }
    if (subsystem !== undefined) {
      const plan = planSubsystemRemoval(model, subsystem.id);
      const removedSubsystemIds = new Set(plan.removedSubsystemIds);
      const removedDeviceIds = new Set(plan.removedDeviceIds);
      const removedCommandIds = new Set(plan.removedCommandIds);
      const removedBindingIds = new Set(plan.removedBindingIds);
      const removedAutoIds = new Set(plan.removedAutoIds);
      const removedPresetIds = new Set(plan.removedPresetIds);
      this.deleteImpact = {
        command: { collection: 'subsystems', id: subsystem.id, type: 'remove' },
        files: [
          'project.yaml',
          ...model.subsystems
            .filter((entry) => removedSubsystemIds.has(entry.id))
            .map((entry) => subsystemJavaLocation(model, entry).file),
          'src/main/java/**/RobotContainer.java',
          'src/main/java/**/commands/RobotCommands.java',
          'docs/HARDWARE_MAP.md',
          'docs/SUBSYSTEMS.md',
          'docs/STATE_MODEL.md',
        ],
        id: subsystem.id,
        label: subsystem.displayName,
        references: [
          ...model.subsystems
            .filter((entry) => entry.id !== subsystem.id && removedSubsystemIds.has(entry.id))
            .map((entry) =>
              this.#i18n.t('tree.impactSubsystem').replace('{name}', entry.displayName),
            ),
          ...model.devices
            .filter((entry) => removedDeviceIds.has(entry.id))
            .map((entry) => this.#i18n.t('tree.impactDevice').replace('{name}', entry.displayName)),
          ...model.commands
            .filter((entry) => removedCommandIds.has(entry.id))
            .map((entry) =>
              this.#i18n.t('tree.impactCommand').replace('{name}', entry.displayName),
            ),
          ...model.bindings
            .filter((entry) => removedBindingIds.has(entry.id))
            .map((entry) => this.#i18n.t('tree.impactBinding').replace('{name}', entry.input)),
          ...model.autos
            .filter((entry) => removedAutoIds.has(entry.id))
            .map((entry) => this.#i18n.t('tree.impactAuto').replace('{name}', entry.displayName)),
          ...model.presets
            .filter((entry) => removedPresetIds.has(entry.id))
            .map((entry) => this.#i18n.t('tree.impactPreset').replace('{name}', entry.displayName)),
        ],
      };
      this.presentDeleteImpact();
      return;
    }
    if (device === undefined) return;
    const references: string[] = [];
    for (const candidate of model.devices) {
      if (candidate.id === device.id) continue;
      for (const parameter of candidate.parameters) {
        const values = Array.isArray(parameter.value) ? parameter.value : [parameter.value];
        if (values.includes(device.id)) {
          references.push(`${candidate.displayName}.${parameter.displayName}`);
        }
      }
    }
    for (const subsystem of model.subsystems) {
      for (const state of subsystem.stateMachine?.states ?? []) {
        if (state.actions.some((action) => action.targetId === device.id)) {
          references.push(`${subsystem.displayName}.${state.displayName}`);
        }
      }
    }
    const owner = model.subsystems.find((entry) => entry.id === device.parentId);
    const javaFile =
      owner === undefined
        ? 'src/main/java/**/subsystems/**'
        : subsystemJavaLocation(model, owner).file;
    this.deleteImpact = {
      command: { collection: 'devices', id: device.id, type: 'remove' },
      files: ['project.yaml', javaFile, 'docs/HARDWARE_MAP.md', 'docs/TUNING.md'],
      id: device.id,
      label: device.displayName,
      references,
    };
    this.presentDeleteImpact();
  };

  private presentDeleteImpact(): void {
    if (this.settings.previewChanges) {
      this.dialog('delete-impact-dialog')?.show();
      return;
    }
    void this.confirmDeleteSelected();
  }

  private readonly confirmDeleteSelected = async (): Promise<void> => {
    const impact = this.deleteImpact;
    if (impact === undefined) return;
    this.dialog('delete-impact-dialog')?.close();
    await this.previewCommand(impact.command);
    this.deleteImpact = undefined;
  };

  private allowTreeDrop(event: DragEvent, targetId: string): void {
    if (this.canReparent(this.draggedEntityId, targetId)) event.preventDefault();
  }

  private async dropTreeNode(event: DragEvent, targetId: string): Promise<void> {
    event.preventDefault();
    const draggedId = this.draggedEntityId;
    const model = this.model();
    if (!this.canReparent(draggedId, targetId) || draggedId === undefined || model === undefined)
      return;
    const device = model.devices.find((entry) => entry.id === draggedId);
    const subsystem = model.subsystems.find((entry) => entry.id === draggedId);
    await this.previewCommand({
      changes: { parentId: targetId },
      target: {
        collection: device === undefined ? 'subsystems' : 'devices',
        id: device?.id ?? subsystem?.id ?? draggedId,
        scope: 'entity',
      },
      type: 'update',
    });
    this.draggedEntityId = undefined;
  }

  private canReparent(draggedId: string | undefined, targetId: string): boolean {
    const model = this.model();
    if (draggedId === undefined || draggedId === targetId || model === undefined) return false;
    const target = model.subsystems.find((entry) => entry.id === targetId);
    if (target === undefined) return false;
    if (this.isSubsystemSourceReadOnly(model, target)) return false;
    const draggedSubsystem = model.subsystems.find((entry) => entry.id === draggedId);
    if (draggedSubsystem === undefined) {
      const draggedDevice = model.devices.find((entry) => entry.id === draggedId);
      return draggedDevice !== undefined && !this.isEntitySourceReadOnly(model, draggedDevice);
    }
    if (
      this.isSubsystemSourceReadOnly(model, draggedSubsystem) ||
      !subsystemUsesAutomaticJavaLocation(model, draggedSubsystem)
    )
      return false;
    let cursor: Subsystem | undefined = target;
    while (cursor !== undefined) {
      if (cursor.id === draggedSubsystem.id) return false;
      cursor =
        cursor.parentId === undefined
          ? undefined
          : model.subsystems.find((entry) => entry.id === cursor?.parentId);
    }
    return true;
  }

  private onTreeKeyDown(event: KeyboardEvent): void {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const id = (event.target as HTMLElement).dataset.entityId;
      if (id !== undefined) {
        const expanded = this.expandedEntityIds.has(id);
        if ((event.key === 'ArrowRight' && !expanded) || (event.key === 'ArrowLeft' && expanded)) {
          event.preventDefault();
          this.toggleTreeNode(id);
        }
      }
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const nodes = [...this.renderRoot.querySelectorAll<HTMLElement>('.tree-node')];
    const current = nodes.indexOf(event.target as HTMLElement);
    const next = event.key === 'ArrowDown' ? current + 1 : current - 1;
    const target = nodes[Math.max(0, Math.min(nodes.length - 1, next))];
    if (target !== undefined) {
      event.preventDefault();
      target.focus();
    }
  }

  private readonly changeLanguage = async (event: Event): Promise<void> => {
    const language = inputValue(event) as AppSettings['language'];
    this.settings = await window.framework.settings.update({ language });
    this.applyLocale(this.settings);
  };

  private readonly changeTheme = async (event: Event): Promise<void> => {
    const theme = inputValue(event) as AppSettings['theme'];
    this.settings = await window.framework.settings.update({ theme });
    this.setAttribute('theme', theme);
  };

  private readonly changeLogLevel = async (event: Event): Promise<void> => {
    const logLevel = inputValue(event) as AppSettings['logLevel'];
    this.settings = await window.framework.settings.update({ logLevel });
  };

  private readonly changeDefaultProject = async (event: Event): Promise<void> => {
    const target = event.target as HTMLElement & { value?: string };
    const field = target.dataset.defaultField;
    const value = target.value ?? '';
    const current = this.settings.defaultProject;
    const defaultProject =
      field === 'teamNumber'
        ? { ...current, teamNumber: Number(value) }
        : field === 'wpilibYear'
          ? { ...current, wpilibYear: Number(value) }
          : { ...current, javaPackage: value.trim() };
    this.settings = await window.framework.settings.update({ defaultProject });
    this.createTeam = String(defaultProject.teamNumber);
    this.createPackage = defaultProject.javaPackage;
    this.createYear = String(defaultProject.wpilibYear);
  };

  private readonly toggleDensity = async (event: Event): Promise<void> => {
    const selected = (event.target as HTMLElement & { selected: boolean }).selected;
    this.settings = await window.framework.settings.update({
      density: selected ? 'compact' : 'comfortable',
    });
    this.setAttribute('density', this.settings.density);
  };

  private readonly togglePreviewChanges = async (event: Event): Promise<void> => {
    const selected = (event.target as HTMLElement & { selected: boolean }).selected;
    this.settings = await window.framework.settings.update({ previewChanges: selected });
  };

  private readonly changeEditor = async (event: Event): Promise<void> => {
    const id = inputValue(event);
    const editor = this.editors.find((candidate) => candidate.id === id);
    if (editor !== undefined) {
      this.settings = await window.framework.settings.update({ editor });
      this.customEditorExecutable = editor.executable;
      this.customEditorArguments = editor.arguments.join('\n');
    }
  };

  private readonly changeProjectEditor = async (event: Event): Promise<void> => {
    const projectPath = this.project?.path;
    if (projectPath === undefined) return;
    const editorId = inputValue(event);
    const projectEditors = Object.fromEntries(
      Object.entries(this.settings.projectEditors).filter(([path]) => path !== projectPath),
    );
    if (editorId.length > 0) projectEditors[projectPath] = editorId;
    this.settings = await window.framework.settings.update({
      projectEditors,
    });
  };

  private projectEditorId(): string {
    const projectPath = this.project?.path;
    if (projectPath === undefined) return '';
    return this.settings.projectEditors[projectPath] ?? this.model()?.project.editorId ?? '';
  }

  private renderExternalToolSetting(
    tool: 'advantagescope' | 'pathplanner',
    name: string,
  ): TemplateResult {
    const t = (key: TranslationKey) => this.#i18n.t(key);
    const configuration = this.settings.externalTools[tool];
    return html`<div class="settings-grid">
      <md-outlined-select
        label="${name} · ${t('settings.externalToolMode')}"
        .value=${configuration.mode}
        @change=${(event: Event) => this.changeExternalToolMode(tool, event)}
      >
        <md-select-option value="auto"
          ><div slot="headline">${t('settings.externalToolAuto')}</div></md-select-option
        >
        <md-select-option value="custom"
          ><div slot="headline">${t('settings.externalToolCustom')}</div></md-select-option
        >
      </md-outlined-select>
      <md-outlined-text-field
        label=${t(
          tool === 'advantagescope' ? 'settings.advantageScopePath' : 'settings.pathPlannerPath',
        )}
        .value=${configuration.executable ?? ''}
        ?disabled=${configuration.mode !== 'custom'}
        @change=${(event: Event) => this.changeExternalToolPath(tool, event)}
      ></md-outlined-text-field>
      <md-outlined-button
        ?disabled=${configuration.mode !== 'custom'}
        @click=${() => this.chooseExternalToolPath(tool)}
        >${t('settings.browse')}</md-outlined-button
      >
    </div>`;
  }

  private readonly changeExternalToolMode = async (
    tool: 'advantagescope' | 'pathplanner',
    event: Event,
  ): Promise<void> => {
    const mode = inputValue(event) as 'auto' | 'custom';
    this.settings = await window.framework.settings.update({
      externalTools: {
        ...this.settings.externalTools,
        [tool]: { ...this.settings.externalTools[tool], mode },
      },
    });
  };

  private readonly changeExternalToolPath = async (
    tool: 'advantagescope' | 'pathplanner',
    event: Event,
  ): Promise<void> => {
    const executable = inputValue(event).trim();
    this.settings = await window.framework.settings.update({
      externalTools: {
        ...this.settings.externalTools,
        [tool]: {
          mode: 'custom',
          ...(executable.length === 0 ? {} : { executable }),
        },
      },
    });
  };

  private async chooseExternalToolPath(tool: 'advantagescope' | 'pathplanner'): Promise<void> {
    const executable = await window.framework.external.choose(tool);
    if (executable === undefined) return;
    this.settings = await window.framework.settings.update({
      externalTools: {
        ...this.settings.externalTools,
        [tool]: { executable, mode: 'custom' },
      },
    });
  }

  private availableEditors(): readonly EditorCandidate[] {
    const configured = this.settings.editor;
    if (configured === undefined || this.editors.some((editor) => editor.id === configured.id)) {
      return this.editors;
    }
    return [...this.editors, configured];
  }

  private readonly saveCustomEditor = async (): Promise<void> => {
    const editor: EditorConfiguration = {
      arguments: this.customEditorArguments.split(/\r?\n/u).filter((value) => value.length > 0),
      executable: this.customEditorExecutable,
      id: 'custom',
      name: this.#i18n.t('settings.customEditor'),
    };
    await this.run(async () => {
      this.settings = await window.framework.settings.update({ editor });
    });
  };

  private readonly testEditor = async (): Promise<void> => {
    const editor = this.settings.editor;
    const project = this.project?.path ?? this.directorySelection?.path;
    if (editor === undefined || project === undefined) return;
    await this.run(async () => {
      await window.framework.editor.open(editor, {
        file: `${project}/project.yaml`,
        line: 1,
        project,
      });
    });
  };

  private readonly onDrop = async (event: DragEvent): Promise<void> => {
    event.preventDefault();
    const file = event.dataTransfer?.files[0];
    if (file === undefined) return;
    await this.run(async () => {
      this.project = await window.framework.project.openDroppedFile(file);
      this.restoreTreeState(this.project);
      this.notice = this.project.path;
      await this.refreshRecent();
    });
  };

  private startResize(kind: 'left' | 'inspector' | 'bottom', event: PointerEvent): void {
    event.preventDefault();
    const initial = this.layout;
    const startX = event.clientX;
    const startY = event.clientY;
    const move = (moveEvent: PointerEvent): void => {
      if (kind === 'left') {
        const maximum = Math.min(
          PANEL_LAYOUT.leftMaximum,
          Math.max(
            PANEL_LAYOUT.leftMinimum,
            window.innerWidth - initial.inspectorWidth - PANEL_LAYOUT.workspaceMinimum,
          ),
        );
        this.layout = {
          ...this.layout,
          leftPanelWidth: clamp(
            initial.leftPanelWidth + moveEvent.clientX - startX,
            PANEL_LAYOUT.leftMinimum,
            maximum,
          ),
        };
      } else if (kind === 'inspector') {
        const maximum = Math.min(
          PANEL_LAYOUT.inspectorMaximum,
          Math.max(
            PANEL_LAYOUT.inspectorMinimum,
            window.innerWidth - initial.leftPanelWidth - PANEL_LAYOUT.workspaceMinimum,
          ),
        );
        this.layout = {
          ...this.layout,
          inspectorWidth: clamp(
            initial.inspectorWidth - moveEvent.clientX + startX,
            PANEL_LAYOUT.inspectorMinimum,
            maximum,
          ),
        };
      } else {
        this.layout = {
          ...this.layout,
          bottomPanelHeight: clamp(initial.bottomPanelHeight - moveEvent.clientY + startY, 96, 420),
        };
      }
    };
    const up = (): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.#preferredPanelWidths = {
        inspectorWidth: this.layout.inspectorWidth,
        leftPanelWidth: this.layout.leftPanelWidth,
      };
      void window.framework.window.updateState({
        bottomPanelHeight: this.layout.bottomPanelHeight,
        inspectorWidth: this.layout.inspectorWidth,
        leftPanelWidth: this.layout.leftPanelWidth,
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  }

  private applyLocale(settings: AppSettings): void {
    this.#i18n.setLocale(
      settings.language === 'system' ? resolveLocale(navigator.language) : settings.language,
    );
    document.documentElement.lang = this.#i18n.locale;
    this.requestUpdate();
  }

  private selectionLabel(): string {
    if (this.project !== undefined) return this.project.displayName;
    const kind = this.directorySelection?.kind;
    return kind === undefined
      ? this.#i18n.t('inspector.noSelection')
      : this.#i18n.t(`directory.${kind}` as TranslationKey);
  }

  private async run(operation: () => Promise<void>): Promise<void> {
    this.working = true;
    this.noticeError = false;
    try {
      await operation();
    } catch (error) {
      this.showError(error);
    } finally {
      this.working = false;
    }
  }

  private showError(error: unknown): void {
    this.noticeError = true;
    this.notice = error instanceof Error ? error.message : this.#i18n.t('error.generic');
  }

  private onKeyDown(event: KeyboardEvent): void {
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.openCommandPalette();
    } else if (command && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      void this.chooseDirectory();
    } else if (command && event.key === '/') {
      event.preventDefault();
      this.openHelp();
    }
  }

  private openCreateDialog(): void {
    this.dialog('create-dialog')?.show();
  }

  private openSettings(): void {
    this.dialog('settings-dialog')?.show();
  }

  private openCommandPalette(): void {
    this.dialog('command-dialog')?.show();
  }

  private openHelp(): void {
    this.dialog('help-dialog')?.show();
  }

  private openAbout(): void {
    this.dialog('about-dialog')?.show();
  }

  private readonly checkForUpdates = async (): Promise<void> => {
    await this.run(async () => {
      this.updateCheck = await window.framework.app.checkUpdates();
    });
  };

  private closeAbout(): void {
    this.dialog('about-dialog')?.close();
  }

  private readonly commandOpenProject = (): void => {
    this.dialog('command-dialog')?.close();
    void this.chooseDirectory();
  };

  private readonly commandCreateProject = (): void => {
    this.dialog('command-dialog')?.close();
    this.openCreateDialog();
  };

  private readonly commandSettings = (): void => {
    this.dialog('command-dialog')?.close();
    this.openSettings();
  };

  private dialog(id: string): (HTMLElement & { close(): void; show(): void }) | null {
    return this.renderRoot.querySelector(`#${id}`);
  }
}

interface WorkspaceProblem {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly detail: string;
  readonly source: string;
  readonly entityId?: string;
  readonly field?: string;
  readonly file?: string | undefined;
  readonly line?: number;
  readonly column?: number;
  readonly quickFix?: WorkspaceQuickFix;
}

interface WorkspaceQuickFix {
  readonly label: string;
  readonly command: DomainCommand;
}

const CHINESE_PARAMETER_CATEGORIES: Readonly<Record<string, string>> = {
  control: '闭环控制',
  electrical: '电气与输出',
  feedback: '传感器反馈',
  identity: '硬件连接',
  limits: '安全限位',
  motion: '运动规划',
  simulation: '仿真',
  telemetry: '遥测',
};

const CHINESE_PARAMETER_DESCRIPTIONS: Readonly<Record<string, string>> = {
  channel: '设备连接的 PWM、DIO 或模拟通道编号。',
  closedLoopRamp: '闭环请求从零渐变到完整输出所需的时间。',
  continuousWrap: '旋转机构跨越一圈边界时使用最短方向到达目标。',
  feedbackSource: '选择电机闭环使用的传感器来源。',
  forwardSoftLimit: '机构允许到达的最大软件位置，超过后禁止继续正向输出。',
  forwardSoftLimitEnabled: '启用正向软件限位保护。',
  gravityType: '选择升降机构或旋转机械臂使用的重力前馈模型。',
  inversion: '定义哪一个电机旋转方向是机构的正方向。',
  inverted: '反转传感器状态或输出方向。',
  leaderId: 'Follower 电机所跟随的主电机实体。',
  length: '连接到该输出的可寻址 LED 数量。',
  magnetOffset: '机构位于已知基准位置时使用的绝对编码器偏移。',
  motionMagicAcceleration: 'Motion Magic 轨迹允许的最大加速度。',
  motionMagicJerk: 'Motion Magic 轨迹允许的最大加速度变化率。',
  motionMagicVelocity: 'Motion Magic 轨迹允许的最大巡航速度。',
  neutralMode: '电机零输出时选择 Brake 保持或 Coast 滑行。',
  openLoopRamp: '开环请求从零渐变到完整输出所需的时间。',
  opposeLeader: '让 Follower 使用与主电机相反的输出方向。',
  remoteEncoderEnabled: '使用外部 CANcoder 作为闭环反馈传感器。',
  remoteEncoderId: '闭环反馈所使用的远程 CANcoder ID。',
  reverseSoftLimit: '机构允许到达的最小软件位置，超过后禁止继续反向输出。',
  reverseSoftLimitEnabled: '启用反向软件限位保护。',
  rotorToSensorRatio: '电机转子转数与远程传感器转数的比例。',
  sensorDirection: '定义绝对编码器的正旋转方向。',
  sensorToMechanismRatio: '传感器每转与机构每转的比例，用于换算机构单位。',
  setpoints: '机构命名目标，例如 HOME=0 或 SPEAKER=85。',
  setpointUnit: '命名目标与到位判断使用的物理单位。',
  statorCurrentLimit: '限制电机绕组电流，保护电机和机械结构。',
  supplyCurrentLimit: '限制控制器从电池侧获取的电流。',
  threshold: '传感器在“未检测/已检测”之间切换的电压阈值。',
  tolerance: '判断机构已经到达目标时允许的最大误差。',
  zeroingCurrent: '归零碰到机械止挡时用于确认到位的电流阈值。',
  zeroingVoltage: '归零时朝基准方向施加的低电压。',
};

function defaultExpandedSourcePaths(files: readonly ProjectSourceFile[]): readonly string[] {
  const expanded = new Set<string>();
  for (const file of files) {
    const segments = file.path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const directory = segments.slice(0, index).join('/');
      if (index === 1 || (segments[0] === 'src' && index <= 3)) expanded.add(directory);
    }
  }
  return [...expanded].sort();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1_024) return `${String(bytes)} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function inputValue(event: Event): string {
  return (event.target as HTMLInputElement).value;
}

function constrainPanelLayout(layout: WindowState, viewportWidth: number): WindowState {
  const left = clamp(layout.leftPanelWidth, PANEL_LAYOUT.leftMinimum, PANEL_LAYOUT.leftMaximum);
  const inspector = clamp(
    layout.inspectorWidth,
    PANEL_LAYOUT.inspectorMinimum,
    PANEL_LAYOUT.inspectorMaximum,
  );
  const minimumPanels = PANEL_LAYOUT.leftMinimum + PANEL_LAYOUT.inspectorMinimum;
  const availablePanels = Math.max(minimumPanels, viewportWidth - PANEL_LAYOUT.workspaceMinimum);
  const flexBudget = Math.max(0, availablePanels - minimumPanels);
  const leftFlex = left - PANEL_LAYOUT.leftMinimum;
  const inspectorFlex = inspector - PANEL_LAYOUT.inspectorMinimum;
  const requestedFlex = leftFlex + inspectorFlex;
  if (requestedFlex <= flexBudget) {
    return { ...layout, inspectorWidth: inspector, leftPanelWidth: left };
  }
  const scale = requestedFlex === 0 ? 0 : flexBudget / requestedFlex;
  return {
    ...layout,
    inspectorWidth: Math.round(PANEL_LAYOUT.inspectorMinimum + inspectorFlex * scale),
    leftPanelWidth: Math.round(PANEL_LAYOUT.leftMinimum + leftFlex * scale),
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : `${value[0]?.toLowerCase()}${value.slice(1)}`;
}

function tuple(value: string, length: number): readonly number[] {
  const values = value.split(',').map((entry) => Number(entry.trim()));
  if (values.length !== length || values.some((entry) => !Number.isFinite(entry))) {
    throw new Error(`Expected ${String(length)} comma-separated numbers.`);
  }
  return values;
}

function tuple3(value: string): readonly [number, number, number] {
  return tuple(value, 3) as readonly [number, number, number];
}

function tuple4(value: string): readonly [number, number, number, number] {
  return tuple(value, 4) as readonly [number, number, number, number];
}

function tuple6(value: string): readonly [number, number, number, number, number, number] {
  return tuple(value, 6) as readonly [number, number, number, number, number, number];
}

function ntAddresses(teamNumber: number): readonly string[] {
  const team = Math.max(0, Math.trunc(teamNumber));
  return [
    `10.${String(Math.floor(team / 100))}.${String(team % 100)}.2`,
    `roborio-${String(team)}-frc.local`,
    '127.0.0.1',
    'localhost',
  ];
}

function formatValue(value: unknown): string {
  if (value instanceof Uint8Array) return `[${String(value.length)} bytes]`;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'number')
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 }).format(value);
  return String(value);
}

declare global {
  interface HTMLElementTagNameMap {
    'frc-framework-app': AppShell;
  }
}
