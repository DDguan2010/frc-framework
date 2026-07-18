import { existsSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { createEmptyProject } from '../../packages/domain/src/index.js';
import { generateProject } from '../../packages/code-generator/src/index.js';
import { JavaProjectIndexer } from '../../packages/java-parser/src/index.js';
import { describe, expect, it } from 'vitest';

const enabled = process.env.FRC_FRAMEWORK_RUN_PERFORMANCE === '1';
const referenceRoot = path.resolve('../2026-offseason-robot-10541');

describe.runIf(enabled)('performance budgets', () => {
  it.runIf(existsSync(referenceRoot))(
    'indexes the 10541 project incrementally within the Beta budgets',
    async () => {
      const indexer = await JavaProjectIndexer.create();
      try {
        const firstStart = performance.now();
        const first = await indexer.indexProject(referenceRoot);
        const firstMs = performance.now() - firstStart;
        const incrementalStart = performance.now();
        const second = await indexer.indexProject(referenceRoot);
        const incrementalMs = performance.now() - incrementalStart;
        process.stdout.write(
          `PERF 10541 files=${String(first.files.length)} first=${firstMs.toFixed(1)}ms incremental=${incrementalMs.toFixed(1)}ms\n`,
        );
        expect(firstMs).toBeLessThan(5_000);
        expect(incrementalMs).toBeLessThan(500);
        expect(second.cacheHits).toBe(first.files.length);
      } finally {
        indexer.dispose();
      }
    },
    30_000,
  );

  it('generates a large structured tree without unbounded memory growth', async () => {
    const base = createEmptyProject({
      id: '10000000-0000-4000-8000-000000000001',
      javaPackage: 'frc.robot.performance',
      name: 'Performance Robot',
      teamNumber: 10541,
      wpilibYear: 2026,
    });
    const model = {
      ...base,
      subsystems: Array.from({ length: 500 }, (_value, index) => ({
        displayName: `Subsystem ${String(index)}`,
        id: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        kind: 'subsystem' as const,
        symbol: `Subsystem${String(index)}`,
      })),
    };
    const heapBefore = process.memoryUsage().heapUsed;
    const started = performance.now();
    for (let iteration = 0; iteration < 10; iteration += 1) await generateProject(model);
    const durationMs = performance.now() - started;
    const heapGrowth = Math.max(0, process.memoryUsage().heapUsed - heapBefore);
    process.stdout.write(
      `PERF large-tree iterations=10 total=${durationMs.toFixed(1)}ms heap-growth=${String(heapGrowth)}B\n`,
    );
    expect(durationMs).toBeLessThan(10_000);
    expect(heapGrowth).toBeLessThan(256 * 1024 * 1024);
  }, 30_000);
});
