import { createEmptyProject, createEntityId, executeCommand } from '@frc-framework/domain';
import { describe, expect, it } from 'vitest';

import {
  captureTuningSnapshot,
  collectTuningParameters,
  compareTuningValues,
  createWriteNtValuesCommand,
  createSaveTuningSnapshotCommand,
} from './tuning.js';

function fixture() {
  const base = createEmptyProject({
    javaPackage: 'frc.robot',
    name: 'Robot',
    teamNumber: 1,
    wpilibYear: 2026,
  });
  const subsystemId = createEntityId();
  const mechanismId = createEntityId();
  const deviceId = createEntityId();
  const parameterId = createEntityId();
  return {
    model: {
      ...base,
      devices: [
        {
          canId: 2,
          displayName: 'Flywheel',
          id: deviceId,
          kind: 'motor' as const,
          model: 'TalonFX',
          parameters: [
            {
              displayName: 'kP',
              id: parameterId,
              key: 'kP',
              maximum: 2,
              minimum: 0,
              networkTables: { enabled: true, tolerance: 0.001, writable: true },
              source: 'user' as const,
              type: 'number' as const,
              unit: 'V/rot',
              value: 0.2,
            },
          ],
          parentId: mechanismId,
          symbol: 'Flywheel',
          vendor: 'CTRE',
        },
      ],
      subsystems: [
        { displayName: 'Shooter', id: subsystemId, kind: 'subsystem' as const, symbol: 'Shooter' },
        {
          displayName: 'Upper',
          id: mechanismId,
          kind: 'mechanism' as const,
          parentId: subsystemId,
          symbol: 'Upper',
        },
      ],
    },
    parameterId,
  };
}

describe('NT tuning model', () => {
  it('resolves project declarations to narrow automatic topic paths', () => {
    const declarations = collectTuningParameters(fixture().model);
    expect(declarations).toHaveLength(1);
    expect(declarations[0]?.path).toBe('/Tuning/Shooter/Upper/Flywheel/kP');
    expect(declarations[0]?.type).toBe('double');
  });

  it('compares tolerance, stale, type mismatch, and range without enabling unsafe writes', () => {
    const declarations = collectTuningParameters(fixture().model);
    expect(
      compareTuningValues(
        declarations,
        new Map([
          [
            '/Tuning/Shooter/Upper/Flywheel/kP',
            { type: 'double', updatedAtMillis: 9_500, value: 0.2005 },
          ],
        ]),
        { nowMillis: 10_000 },
      )[0]?.state,
    ).toBe('equal');
    expect(
      compareTuningValues(
        declarations,
        new Map([
          [
            '/Tuning/Shooter/Upper/Flywheel/kP',
            { type: 'double', updatedAtMillis: 9_500, value: 0.24 },
          ],
        ]),
        { nowMillis: 10_000 },
      )[0],
    ).toMatchObject({ delta: 0.03999999999999998, selectable: true, state: 'different' });
    expect(
      compareTuningValues(
        declarations,
        new Map([
          [
            '/Tuning/Shooter/Upper/Flywheel/kP',
            { type: 'string', updatedAtMillis: 9_500, value: 'bad' },
          ],
        ]),
        { nowMillis: 10_000 },
      )[0],
    ).toMatchObject({ selectable: false, state: 'type-mismatch' });
    expect(
      compareTuningValues(
        declarations,
        new Map([
          ['/Tuning/Shooter/Upper/Flywheel/kP', { type: 'double', updatedAtMillis: 1, value: 0.3 }],
        ]),
        { nowMillis: 10_000 },
      )[0]?.state,
    ).toBe('stale');
    expect(
      compareTuningValues(
        declarations,
        new Map([
          [
            '/Tuning/Shooter/Upper/Flywheel/kP',
            { type: 'double', updatedAtMillis: 9_500, value: 3 },
          ],
        ]),
        { nowMillis: 10_000 },
      )[0],
    ).toMatchObject({ selectable: false, state: 'out-of-range' });
  });

  it('creates one reversible batch command and named snapshot for selected safe values', () => {
    const { model, parameterId } = fixture();
    const comparisons = compareTuningValues(
      collectTuningParameters(model),
      new Map([
        [
          '/Tuning/Shooter/Upper/Flywheel/kP',
          { type: 'double', updatedAtMillis: 9_500, value: 0.24 },
        ],
      ]),
      { nowMillis: 10_000 },
    );
    const command = createWriteNtValuesCommand(
      model,
      comparisons,
      new Set([parameterId]),
      new Date('2026-01-01T00:00:00Z'),
    );
    const result = executeCommand(model, command);
    expect(result.model.devices[0]?.parameters[0]).toMatchObject({
      source: 'networktables',
      value: 0.24,
    });
    expect(result.model.tuningHistory[0]).toMatchObject({
      source: 'networktables',
      writtenAt: '2026-01-01T00:00:00.000Z',
      changes: [{ oldValue: 0.2, newValue: 0.24 }],
    });
    expect(executeCommand(result.model, result.inverse).model).toEqual(model);
    expect(
      captureTuningSnapshot(' Practice ', comparisons, new Date('2026-01-01T00:00:00Z')),
    ).toMatchObject({
      capturedAt: '2026-01-01T00:00:00.000Z',
      name: 'Practice',
      values: { '/Tuning/Shooter/Upper/Flywheel/kP': 0.24 },
    });
    const snapshotted = executeCommand(
      model,
      createSaveTuningSnapshotCommand(
        model,
        'Practice',
        comparisons,
        new Date('2026-01-01T00:00:00Z'),
      ),
    ).model;
    expect(snapshotted.tuningSnapshots[0]).toMatchObject({
      capturedAt: '2026-01-01T00:00:00.000Z',
      name: 'Practice',
    });
  });
});
