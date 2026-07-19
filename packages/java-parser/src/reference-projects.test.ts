import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { validateModel } from '@frc-framework/domain';
import { parseProjectYaml } from '../../project-io/src/yaml-project.js';

import { JavaParserService } from './java-parser.js';
import { JavaProjectIndexer } from './project-indexer.js';

const baseRobot = path.resolve('../frc-code-base/src/main/java/frc/robot/RobotContainer.java');
const fullRobot = path.resolve(
  '../2026-offseason-robot-10541/src/main/java/frc/robot/RobotContainer.java',
);
const shooter = path.resolve(
  '../2026-offseason-robot-10541/src/main/java/frc/robot/subsystems/Shooter/ShootingSuperstructure.java',
);
const fullProjectRoot = path.resolve('../2026-offseason-robot-10541');
const fullProjectYaml = path.join(fullProjectRoot, 'project.yaml');
const referencesAvailable = [baseRobot, fullRobot, shooter].every(existsSync);

describe.runIf(referencesAvailable)('local reference robot projects', () => {
  let parser: JavaParserService;

  beforeAll(async () => {
    parser = await JavaParserService.create();
  });

  afterAll(() => {
    parser.dispose();
  });

  it('indexes the base RobotContainer without a parser failure', async () => {
    const index = parser.index(await readFile(baseRobot, 'utf8'));
    expect(index.packageName).toBe('frc.robot');
    expect(index.types.some((type) => type.name === 'RobotContainer')).toBe(true);
  });

  it('finds real controller bindings in the 10541 RobotContainer', async () => {
    const index = parser.index(await readFile(fullRobot, 'utf8'));
    expect(index.controllers.length).toBeGreaterThanOrEqual(2);
    expect(index.bindings.length).toBeGreaterThan(10);
    expect(index.patterns.some((pattern) => pattern.family === 'ironpulse')).toBe(true);
  });

  it('finds command factories in the Shooter superstructure', async () => {
    const index = parser.index(await readFile(shooter, 'utf8'));
    expect(index.types.some((type) => type.name === 'ShootingSuperstructure')).toBe(true);
    expect(index.commandMethods.length).toBeGreaterThan(5);
  });

  it('builds a stable source-fallback import report for the complete 10541 project', async () => {
    const indexer = await JavaProjectIndexer.create();
    try {
      const report = await indexer.indexProject(fullProjectRoot);
      expect(report.files.length).toBeGreaterThanOrEqual(120);
      expect(report.customFiles.length).toBeGreaterThanOrEqual(80);
      expect(report.partialFiles).toEqual([]);
      expect(report.model.subsystems.length).toBeGreaterThanOrEqual(6);
      expect(report.model.commands.length).toBeGreaterThanOrEqual(120);
      expect(report.model.controllers.length).toBeGreaterThanOrEqual(2);
      expect(report.model.bindings.length).toBeGreaterThanOrEqual(10);
      expect(report.model.subsystems.some((entry) => entry.displayName === 'Shooter')).toBe(true);
      expect(report.model.subsystems.some((entry) => entry.symbol === 'ShotCalculator')).toBe(
        false,
      );
      expect(report.model.commands.some((entry) => entry.symbol === 'AutoAimCommand')).toBe(true);
      expect(report.model.subsystems.some((entry) => entry.symbol.endsWith('Config'))).toBe(false);
      expect(report.model.controllers.length).toBeGreaterThanOrEqual(2);
      expect(report.model.bindings.length).toBeGreaterThan(10);
      expect(report.model.commands.length).toBeGreaterThan(10);
      expect(report.customFiles.length).toBeGreaterThan(0);
      expect(validateModel(report.model).filter((problem) => problem.severity === 'error')).toEqual(
        [],
      );
      const second = await indexer.indexProject(fullProjectRoot);
      expect(second.cacheHits).toBe(report.files.length);
      expect(second.model.commands).toHaveLength(report.model.commands.length);
      expect(second.model.subsystems).toHaveLength(report.model.subsystems.length);
    } finally {
      indexer.dispose();
    }
  }, 30_000);

  it('opens the migrated 10541 YAML without duplicate IDs or rejecting multi-command triggers', async () => {
    const parsed = parseProjectYaml(await readFile(fullProjectYaml, 'utf8'));
    expect(parsed.problems).toEqual([]);
    expect(parsed.model).toBeDefined();
    expect(validateModel(parsed.model!).filter((problem) => problem.severity === 'error')).toEqual(
      [],
    );
  });
});
