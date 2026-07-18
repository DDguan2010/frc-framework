import { createEmptyProject } from '@frc-framework/domain';
import { describe, expect, it } from 'vitest';

import {
  CATALOG_VERSION,
  COMPONENT_CATALOG,
  instantiateCatalogDevice,
  validateHardware,
} from './index.js';

describe('IronPulse component catalog', () => {
  it('has a versioned, unique definition and generator mapping for every component', () => {
    expect(new Set(COMPONENT_CATALOG.map((entry) => entry.id)).size).toBe(COMPONENT_CATALOG.length);
    for (const definition of COMPONENT_CATALOG) {
      expect(definition.version).toBe(CATALOG_VERSION);
      expect(definition.realClass).not.toBe('');
      expect(definition.simClass).not.toBe('');
      expect(definition.parameters.length).toBeGreaterThan(0);
      for (const parameter of definition.parameters) {
        expect(parameter.mapping.javaPath).not.toBe('');
      }
    }
  });

  it('instantiates only required, common, or explicitly selected parameters', () => {
    const motor = instantiateCatalogDevice({
      canBus: 'rio',
      canId: 4,
      componentId: 'ironpulse.talonfx-primary',
      displayName: 'Upper Flywheel',
      parentId: 'mechanism',
      publishToNetworkTables: ['kP'],
      selectedParameters: ['kP', 'motionMagicJerk'],
      values: { kP: 0.18 },
    });
    expect(motor.parameters.find((entry) => entry.key === 'kP')?.value).toBe(0.18);
    expect(motor.parameters.find((entry) => entry.key === 'kP')?.networkTables?.enabled).toBe(true);
    expect(motor.parameters.some((entry) => entry.key === 'motionMagicJerk')).toBe(true);
    expect(motor.parameters.some((entry) => entry.key === 'kI')).toBe(false);
  });

  it('reports hardware conflicts, follower errors, invalid ranges, and NT path conflicts', () => {
    const model = createEmptyProject({
      javaPackage: 'frc.robot',
      name: 'Test',
      teamNumber: 1,
      wpilibYear: 2026,
    });
    const leader = instantiateCatalogDevice({
      canId: 1,
      componentId: 'ironpulse.talonfx-primary',
      displayName: 'Leader',
      parentId: 'mechanism',
      publishToNetworkTables: ['kP'],
      selectedParameters: ['kP'],
    });
    const duplicate = instantiateCatalogDevice({
      canId: 1,
      componentId: 'ironpulse.talonfx-primary',
      displayName: 'Leader',
      parentId: 'mechanism',
      publishToNetworkTables: ['kP'],
      selectedParameters: ['kP', 'sensorToMechanismRatio'],
      values: { sensorToMechanismRatio: 0 },
    });
    const follower = instantiateCatalogDevice({
      canBus: 'canivore',
      canId: 2,
      componentId: 'ironpulse.talonfx-follower',
      displayName: 'Follower',
      parentId: 'mechanism',
      values: { leaderId: leader.id },
    });
    const problems = validateHardware({ ...model, devices: [leader, duplicate, follower] });
    expect(problems.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        'port-conflict',
        'invalid-parameter',
        'bus-mismatch',
        'nt-path-conflict',
      ]),
    );
  });
});
