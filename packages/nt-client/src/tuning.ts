import type {
  BatchCommand,
  DomainCommand,
  Device,
  DeviceParameter,
  FrcProjectModel,
  ParameterValue,
  Subsystem,
} from '@frc-framework/domain';
import { createEntityId } from '@frc-framework/domain';

import type { NtType, NtValue, NtValueUpdate } from './types.js';

export type TuningComparisonState =
  'equal' | 'different' | 'missing' | 'stale' | 'type-mismatch' | 'out-of-range';

export interface DeclaredTuningParameter {
  readonly parameterId: string;
  readonly deviceId: string;
  readonly subsystemId: string;
  readonly subsystemName: string;
  readonly mechanismName: string;
  readonly deviceName: string;
  readonly displayName: string;
  readonly key: string;
  readonly path: string;
  readonly type: NtType;
  readonly unit?: string;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly tolerance: number;
  readonly writable: boolean;
  readonly codeValue: ParameterValue;
}

export interface LiveTuningValue {
  readonly type: NtType;
  readonly value: NtValue;
  readonly updatedAtMillis: number;
}

export interface TuningComparison extends DeclaredTuningParameter {
  readonly state: TuningComparisonState;
  readonly liveValue?: NtValue;
  readonly updatedAtMillis?: number;
  readonly delta?: number;
  readonly selectable: boolean;
  readonly detail?: string;
}

export interface TuningSnapshot {
  readonly name: string;
  readonly capturedAt: string;
  readonly values: Readonly<Record<string, NtValue>>;
}

export function collectTuningParameters(
  model: FrcProjectModel,
): readonly DeclaredTuningParameter[] {
  const result: DeclaredTuningParameter[] = [];
  for (const device of model.devices) {
    const lineage = subsystemLineage(model, device);
    const root = lineage[0];
    if (root === undefined) continue;
    const mechanism = lineage.at(-1) ?? root;
    for (const parameter of device.parameters) {
      if (parameter.networkTables?.enabled !== true) continue;
      result.push({
        codeValue: parameter.value,
        deviceId: device.id,
        deviceName: device.displayName,
        displayName: parameter.displayName,
        key: parameter.key,
        ...(parameter.maximum === undefined ? {} : { maximum: parameter.maximum }),
        mechanismName: mechanism.displayName,
        ...(parameter.minimum === undefined ? {} : { minimum: parameter.minimum }),
        parameterId: parameter.id,
        path: resolveTuningPath(model, device, parameter, lineage),
        subsystemId: root.id,
        subsystemName: root.displayName,
        tolerance: parameter.networkTables.tolerance ?? defaultTolerance(parameter),
        type: parameterNtType(parameter),
        ...(parameter.unit === undefined ? {} : { unit: parameter.unit }),
        writable: parameter.networkTables.writable === true,
      });
    }
  }
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

export function resolveTuningPath(
  model: FrcProjectModel,
  device: Device,
  parameter: DeviceParameter,
  providedLineage?: readonly Subsystem[],
): string {
  if (parameter.networkTables?.path !== undefined)
    return normalizeNtPath(parameter.networkTables.path);
  if (device.networkTablesPath !== undefined)
    return joinNtPath(device.networkTablesPath, parameter.key);
  const lineage = providedLineage ?? subsystemLineage(model, device);
  const override = [...lineage]
    .reverse()
    .find((entry) => entry.networkTablesPath !== undefined)?.networkTablesPath;
  if (override !== undefined) return joinNtPath(override, device.displayName, parameter.key);
  return joinNtPath(
    model.networkTables.rootPath,
    ...lineage.map((entry) => entry.displayName),
    device.displayName,
    parameter.key,
  );
}

export function compareTuningValues(
  declarations: readonly DeclaredTuningParameter[],
  liveValues: ReadonlyMap<string, LiveTuningValue>,
  options: { readonly nowMillis?: number; readonly staleAfterMillis?: number } = {},
): readonly TuningComparison[] {
  const now = options.nowMillis ?? Date.now();
  const staleAfter = options.staleAfterMillis ?? 2_000;
  return declarations.map((declaration) => {
    const live = liveValues.get(declaration.path);
    if (live === undefined) return { ...declaration, selectable: false, state: 'missing' };
    if (live.type !== declaration.type) {
      return {
        ...declaration,
        detail: `Expected ${declaration.type}, received ${live.type}.`,
        liveValue: live.value,
        selectable: false,
        state: 'type-mismatch',
        updatedAtMillis: live.updatedAtMillis,
      };
    }
    if (now - live.updatedAtMillis > staleAfter) {
      return {
        ...declaration,
        liveValue: live.value,
        selectable: false,
        state: 'stale',
        updatedAtMillis: live.updatedAtMillis,
      };
    }
    if (isOutOfRange(declaration, live.value)) {
      return {
        ...declaration,
        liveValue: live.value,
        selectable: false,
        state: 'out-of-range',
        updatedAtMillis: live.updatedAtMillis,
      };
    }
    const equal = valuesEqual(declaration.codeValue, live.value, declaration.tolerance);
    const delta =
      typeof declaration.codeValue === 'number' && typeof live.value === 'number'
        ? live.value - declaration.codeValue
        : undefined;
    return {
      ...declaration,
      ...(delta === undefined ? {} : { delta }),
      liveValue: live.value,
      selectable: declaration.writable && !equal,
      state: equal ? 'equal' : 'different',
      updatedAtMillis: live.updatedAtMillis,
    };
  });
}

export function ntUpdatesToLiveMap(
  updates: readonly NtValueUpdate[],
): ReadonlyMap<string, LiveTuningValue> {
  const result = new Map<string, LiveTuningValue>();
  for (const update of updates) {
    result.set(update.topic.name, {
      type: update.topic.type,
      updatedAtMillis: Math.floor(update.timestampMicros / 1_000),
      value: update.value,
    });
  }
  return result;
}

export function createWriteNtValuesCommand(
  model: FrcProjectModel,
  comparisons: readonly TuningComparison[],
  selectedParameterIds: ReadonlySet<string>,
  writtenAt = new Date(),
): BatchCommand {
  const byDevice = new Map<string, Map<string, TuningComparison>>();
  for (const comparison of comparisons) {
    if (!selectedParameterIds.has(comparison.parameterId)) continue;
    if (!comparison.selectable || comparison.liveValue === undefined) {
      throw new Error(`Parameter ${comparison.path} cannot be written to code.`);
    }
    const entries = byDevice.get(comparison.deviceId) ?? new Map();
    entries.set(comparison.parameterId, comparison);
    byDevice.set(comparison.deviceId, entries);
  }
  const commands: BatchCommand['commands'][number][] = [];
  const historyChanges: FrcProjectModel['tuningHistory'][number]['changes'][number][] = [];
  for (const [deviceId, selected] of byDevice) {
    const device = model.devices.find((entry) => entry.id === deviceId);
    if (device === undefined) throw new Error(`Device ${deviceId} no longer exists.`);
    const parameters = device.parameters.map((parameter) => {
      const comparison = selected.get(parameter.id);
      if (comparison === undefined) return parameter;
      historyChanges.push({
        newValue: comparison.liveValue as ParameterValue,
        oldValue: parameter.value,
        parameterId: parameter.id,
        path: comparison.path,
      });
      return {
        ...parameter,
        source: 'networktables' as const,
        value: comparison.liveValue as ParameterValue,
      };
    });
    commands.push({
      changes: { parameters },
      target: { collection: 'devices', id: deviceId, scope: 'entity' },
      type: 'update',
    });
  }
  if (historyChanges.length > 0) {
    commands.push({
      changes: {
        tuningHistory: [
          ...model.tuningHistory,
          {
            changes: historyChanges,
            id: createEntityId(),
            source: 'networktables',
            writtenAt: writtenAt.toISOString(),
          },
        ],
      },
      target: { scope: 'model' },
      type: 'update',
    });
  }
  return { commands, label: 'Write NT values to code', type: 'batch' };
}

export function createSaveTuningSnapshotCommand(
  model: FrcProjectModel,
  name: string,
  comparisons: readonly TuningComparison[],
  capturedAt = new Date(),
): DomainCommand {
  const snapshot = captureTuningSnapshot(name, comparisons, capturedAt);
  return {
    changes: {
      tuningSnapshots: [
        ...model.tuningSnapshots,
        {
          ...snapshot,
          id: createEntityId(),
          values: snapshot.values as Record<string, ParameterValue>,
        },
      ],
    },
    target: { scope: 'model' },
    type: 'update',
  };
}

export function captureTuningSnapshot(
  name: string,
  comparisons: readonly TuningComparison[],
  capturedAt = new Date(),
): TuningSnapshot {
  const trimmed = name.trim();
  if (trimmed.length === 0) throw new Error('Snapshot name is required.');
  return {
    capturedAt: capturedAt.toISOString(),
    name: trimmed,
    values: Object.fromEntries(
      comparisons
        .filter((entry) => entry.liveValue !== undefined && entry.state !== 'stale')
        .map((entry) => [entry.path, entry.liveValue as NtValue]),
    ),
  };
}

function subsystemLineage(model: FrcProjectModel, device: Device): readonly Subsystem[] {
  const byId = new Map(model.subsystems.map((entry) => [entry.id, entry]));
  const reverse: Subsystem[] = [];
  let current = byId.get(device.parentId);
  const visited = new Set<string>();
  while (current !== undefined && !visited.has(current.id)) {
    reverse.push(current);
    visited.add(current.id);
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  return reverse.reverse();
}

function parameterNtType(parameter: DeviceParameter): NtType {
  switch (parameter.type) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'double';
    case 'number[]':
      return 'double[]';
    case 'string[]':
      return 'string[]';
    case 'enum':
    case 'string':
      return 'string';
  }
}

function defaultTolerance(parameter: DeviceParameter): number {
  return parameter.type === 'number' || parameter.type === 'number[]' ? 1e-6 : 0;
}

function valuesEqual(code: ParameterValue, live: NtValue, tolerance: number): boolean {
  if (typeof code === 'number' && typeof live === 'number')
    return Math.abs(code - live) <= tolerance;
  if (Array.isArray(code) && Array.isArray(live)) {
    return (
      code.length === live.length &&
      code.every((entry, index) => {
        const other = live[index];
        return typeof entry === 'number' && typeof other === 'number'
          ? Math.abs(entry - other) <= tolerance
          : entry === other;
      })
    );
  }
  return code === live;
}

function isOutOfRange(declaration: DeclaredTuningParameter, value: NtValue): boolean {
  return (
    typeof value === 'number' &&
    ((declaration.minimum !== undefined && value < declaration.minimum) ||
      (declaration.maximum !== undefined && value > declaration.maximum))
  );
}

function joinNtPath(...segments: readonly string[]): string {
  return normalizeNtPath(
    segments
      .map((entry) => entry.replace(/^\/+|\/+$/gu, ''))
      .filter(Boolean)
      .join('/'),
  );
}

function normalizeNtPath(value: string): string {
  return `/${value.split('/').filter(Boolean).map(sanitizeSegment).join('/')}`;
}

function sanitizeSegment(value: string): string {
  const result = value
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
  return result.length === 0 ? 'Unnamed' : result;
}
