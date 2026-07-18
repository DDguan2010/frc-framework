export const SCHEMA_VERSION = 1 as const;
export const PRODUCT_NAME = 'FRC Framework';
export const SUPPORTED_WPILIB_YEARS = [2026] as const;

export type Platform = 'win32' | 'darwin' | 'linux';
export type EntityId = string;
export type ParameterValue = boolean | number | string | readonly number[] | readonly string[];
export type ParameterType = 'boolean' | 'number' | 'string' | 'enum' | 'number[]' | 'string[]';
export type ParameterSource = 'default' | 'preset' | 'user' | 'code' | 'networktables';

export interface AppInfo {
  readonly name: string;
  readonly platform: Platform;
  readonly version: string;
  readonly release: {
    readonly schemaVersion: number;
    readonly baseVersion: number;
    readonly presetApiVersion: number;
    readonly presets: readonly {
      readonly id: string;
      readonly version: number;
    }[];
    readonly supportedWpilibYears: readonly number[];
  };
}

export interface EntityBase {
  readonly id: EntityId;
  readonly displayName: string;
  readonly symbol: string;
  readonly notes?: string;
}

export interface ProjectSettings extends EntityBase {
  readonly baseVersion: 1;
  readonly teamNumber: number;
  readonly javaPackage: string;
  readonly wpilibYear: number;
  readonly editorId?: string;
}

export interface RobotModel extends EntityBase {
  readonly mode: 'command-based';
  readonly mainClass: string;
  readonly containerClass: string;
  readonly telemetry?: RobotTelemetrySettings;
}

export interface RobotTelemetrySettings {
  readonly fieldPublisher: boolean;
  readonly stateRecorder: boolean;
}

export interface ParameterCondition {
  readonly parameter: string;
  readonly equals: ParameterValue;
}

export interface NetworkTablesBinding {
  readonly enabled: boolean;
  readonly path?: string;
  readonly writable?: boolean;
  readonly tolerance?: number;
}

export interface DeviceParameter {
  readonly id: EntityId;
  readonly key: string;
  readonly displayName: string;
  readonly description?: string;
  readonly type: ParameterType;
  readonly value: ParameterValue;
  readonly defaultValue?: ParameterValue;
  readonly unit?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly enumValues?: readonly string[];
  readonly condition?: ParameterCondition;
  readonly source: ParameterSource;
  readonly networkTables?: NetworkTablesBinding;
}

export interface Subsystem extends EntityBase {
  readonly kind: 'subsystem' | 'mechanism' | 'group';
  readonly parentId?: EntityId;
  readonly javaFile?: string;
  readonly javaPackage?: string;
  readonly behaviorMode?: 'direct' | 'goal-driven' | 'custom';
  readonly generateGoalCommand?: boolean;
  readonly advantageKitLogging?: boolean;
  readonly realImplementation?: boolean;
  readonly simulationImplementation?: boolean;
  readonly networkTablesPath?: string;
  readonly dependencies?: readonly SubsystemDependency[];
  readonly stateMachine?: StateMachine;
}

export interface SubsystemDependency {
  readonly targetSubsystemId: EntityId;
  readonly fieldName: string;
}

export interface Device extends EntityBase {
  readonly parentId: EntityId;
  readonly kind: 'motor' | 'encoder' | 'gyro' | 'sensor' | 'pneumatic' | 'camera' | 'custom';
  readonly vendor: string;
  readonly model: string;
  readonly catalogId?: string;
  readonly role?: string;
  readonly networkTablesPath?: string;
  readonly canId?: number;
  readonly canBus?: string;
  readonly parameters: readonly DeviceParameter[];
}

export interface StateDefinition extends EntityBase {
  readonly initial?: boolean;
  readonly actions: readonly StateAction[];
}

export interface StateAction {
  readonly targetId: EntityId;
  readonly commandId?: EntityId;
  readonly parameterValues?: Readonly<Record<string, ParameterValue>>;
}

export interface StateTransition {
  readonly id: EntityId;
  readonly fromStateId: EntityId;
  readonly toStateId: EntityId;
  readonly trigger: string;
  readonly guard?: string;
}

export interface StateMachine {
  readonly states: readonly StateDefinition[];
  readonly transitions: readonly StateTransition[];
}

export interface Controller extends EntityBase {
  readonly provider: string;
  readonly port: number;
  readonly role: 'driver' | 'operator' | 'custom';
  readonly customRole?: string;
  readonly deadband?: number;
  readonly axisScale?: number;
  readonly invertAxes?: readonly number[];
  readonly rumbleEnabled?: boolean;
  readonly parameters?: Readonly<Record<string, ParameterValue>>;
}

export interface ControlBinding {
  readonly id: EntityId;
  readonly controllerId: EntityId;
  readonly input: string;
  readonly behavior:
    | 'onTrue'
    | 'onFalse'
    | 'whileTrue'
    | 'whileFalse'
    | 'toggleOnTrue'
    | 'toggleOnFalse'
    | 'axis'
    | 'custom';
  readonly commandId?: EntityId;
  readonly codeReference?: string;
  readonly timeoutSeconds?: number;
  readonly interruptBehavior?: 'cancelSelf' | 'cancelIncoming';
}

export interface CommandDefinition extends EntityBase {
  readonly kind:
    'instant' | 'run' | 'sequence' | 'parallel' | 'race' | 'deadline' | 'either' | 'custom';
  readonly javaFile?: string;
  readonly requirementIds: readonly EntityId[];
  readonly childCommandIds?: readonly EntityId[];
  readonly factory?: boolean;
  readonly codeExpression?: string;
  readonly pathplannerName?: string;
}

export interface AutoRoutine extends EntityBase {
  readonly commandId?: EntityId;
  readonly pathFiles: readonly string[];
}

export interface NetworkTablesSettings {
  readonly enabled: boolean;
  readonly rootPath: string;
  readonly host?: string;
}

export interface DocumentationPage {
  readonly id: EntityId;
  readonly title: string;
  readonly path: string;
  readonly summary?: string;
  readonly generated: boolean;
}

export interface PresetInstance {
  readonly id: EntityId;
  readonly presetId: string;
  readonly version: number;
  readonly displayName: string;
  readonly parameters: Readonly<Record<string, ParameterValue>>;
  readonly customizedFiles: readonly string[];
}

export interface TuningWriteRecord {
  readonly id: EntityId;
  readonly writtenAt: string;
  readonly source: 'networktables';
  readonly changes: readonly {
    readonly parameterId: EntityId;
    readonly path: string;
    readonly oldValue: ParameterValue;
    readonly newValue: ParameterValue;
  }[];
}

export interface TuningSnapshotRecord {
  readonly id: EntityId;
  readonly name: string;
  readonly capturedAt: string;
  readonly values: Readonly<Record<string, ParameterValue>>;
}

export interface FrcProjectModel {
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly project: ProjectSettings;
  readonly robot: RobotModel;
  readonly subsystems: readonly Subsystem[];
  readonly devices: readonly Device[];
  readonly controllers: readonly Controller[];
  readonly bindings: readonly ControlBinding[];
  readonly commands: readonly CommandDefinition[];
  readonly autos: readonly AutoRoutine[];
  readonly networkTables: NetworkTablesSettings;
  readonly docs: readonly DocumentationPage[];
  readonly presets: readonly PresetInstance[];
  readonly tuningHistory: readonly TuningWriteRecord[];
  readonly tuningSnapshots: readonly TuningSnapshotRecord[];
  /** Project-relative generated files intentionally owned by hand-written code. */
  readonly unmanagedFiles: readonly string[];
}

export type EntityCollection =
  'subsystems' | 'devices' | 'controllers' | 'bindings' | 'commands' | 'autos' | 'docs';

export type CollectionEntity<C extends EntityCollection = EntityCollection> = C extends 'subsystems'
  ? Subsystem
  : C extends 'devices'
    ? Device
    : C extends 'controllers'
      ? Controller
      : C extends 'bindings'
        ? ControlBinding
        : C extends 'commands'
          ? CommandDefinition
          : C extends 'autos'
            ? AutoRoutine
            : DocumentationPage;

export function createEmptyProject(input: {
  readonly id?: EntityId;
  readonly name: string;
  readonly teamNumber: number;
  readonly javaPackage: string;
  readonly wpilibYear: number;
}): FrcProjectModel {
  const projectId = input.id ?? createEntityId();
  return {
    autos: [],
    bindings: [],
    commands: [],
    controllers: [],
    devices: [],
    docs: [],
    networkTables: { enabled: true, rootPath: '/Tuning' },
    presets: [],
    tuningHistory: [],
    tuningSnapshots: [],
    unmanagedFiles: [],
    project: {
      baseVersion: 1,
      displayName: input.name,
      id: projectId,
      javaPackage: input.javaPackage,
      symbol: javaSymbol(input.name, 'RobotProject'),
      teamNumber: input.teamNumber,
      wpilibYear: input.wpilibYear,
    },
    robot: {
      containerClass: 'RobotContainer',
      displayName: 'Robot',
      id: createEntityId(),
      mainClass: 'Main',
      mode: 'command-based',
      symbol: 'Robot',
      telemetry: { fieldPublisher: true, stateRecorder: true },
    },
    schemaVersion: SCHEMA_VERSION,
    subsystems: [],
  };
}

export function createEntityId(): EntityId {
  return globalThis.crypto.randomUUID();
}

export function javaSymbol(value: string, fallback = 'Component'): string {
  const words = value.normalize('NFKD').match(/[A-Za-z0-9]+/gu) ?? [];
  const joined = words.map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join('');
  const candidate = joined.length === 0 ? fallback : joined;
  return /^\d/u.test(candidate) ? `_${candidate}` : candidate;
}
