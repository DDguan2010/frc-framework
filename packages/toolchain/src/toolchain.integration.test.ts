import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { discoverJava } from './java-discovery.js';
import { runGradle } from './gradle-runner.js';

const integrationEnabled = process.env.FRC_FRAMEWORK_RUN_WPILIB_INTEGRATION === '1';

describe.runIf(integrationEnabled)('installed WPILib integration', () => {
  it('selects the WPILib JDK and runs tasks, compilation, and simulation dry-run', async () => {
    const projectRoot = path.resolve(process.cwd(), '..', '2026-offseason-robot-10541');
    const discovery = await discoverJava({ projectYear: 2026 });
    expect(discovery.selected?.source).toBe('wpilib');
    expect(discovery.selected?.major).toBe(17);
    const selected = discovery.selected;
    if (selected === undefined) {
      throw new Error(discovery.diagnostics.join('\n'));
    }

    const invocations = [
      { tasks: ['tasks'], timeoutMs: 180_000 },
      { tasks: ['compileJava'], timeoutMs: 300_000 },
      { arguments: ['--dry-run'], tasks: ['simulateJava'], timeoutMs: 180_000 },
    ] as const;
    for (const invocation of invocations) {
      const streamed: string[] = [];
      const result = await runGradle({
        ...invocation,
        java: selected,
        onLog: (event) => streamed.push(event.text),
        projectRoot,
      });
      expect(
        result.success,
        `${invocation.tasks.join(' ')}\nJava: ${JSON.stringify(discovery.selected, null, 2)}\n${JSON.stringify(result, null, 2)}`,
      ).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(streamed.length).toBeGreaterThan(0);
    }
  }, 700_000);
});
