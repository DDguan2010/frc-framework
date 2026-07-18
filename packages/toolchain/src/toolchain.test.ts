import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { discoverJava, requiredJavaMajor, wpilibRoots } from './java-discovery.js';
import { parseGradleDiagnostics } from './gradle-diagnostics.js';
import { gradleInvocation } from './gradle-runner.js';
import { runProcess } from './process-runner.js';

const abortControllers: AbortController[] = [];

afterEach(() => {
  for (const controller of abortControllers.splice(0)) {
    controller.abort();
  }
});

describe('Java discovery', () => {
  it('prefers an explicit compatible JDK, then the matching WPILib year', async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-java-'));
    const publicDirectory = path.join(fixture, 'public');
    const explicitHome = path.join(fixture, 'explicit');
    const javaName = process.platform === 'win32' ? 'java.exe' : 'java';
    const explicit = path.join(explicitHome, 'bin', javaName);
    const matching = path.join(publicDirectory, 'wpilib', '2026', 'jdk', 'bin', javaName);
    const older = path.join(publicDirectory, 'wpilib', '2025', 'jdk', 'bin', javaName);
    for (const executable of [explicit, matching, older]) {
      await mkdir(path.dirname(executable), { recursive: true });
      await writeFile(executable, 'fixture');
    }
    const discovered = await discoverJava({
      env: {},
      explicitJavaHome: explicitHome,
      homeDirectory: path.join(fixture, 'home'),
      platform: process.platform === 'win32' ? 'win32' : 'linux',
      probe: async (executable) => ({
        major: executable === older ? 11 : 17,
        version: executable === older ? '11.0.20' : '17.0.16',
      }),
      projectYear: 2026,
      publicDirectory,
    });
    expect(discovered.selected?.source).toBe('explicit');
    expect(discovered.candidates.map((candidate) => candidate.source)).toEqual([
      'explicit',
      'wpilib',
      'wpilib',
    ]);
    expect(discovered.candidates[1]?.wpilibYear).toBe(2026);
    expect(discovered.candidates[2]?.compatible).toBe(false);
  });

  it('reports a clear diagnostic when only an incompatible system Java exists', async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-java-home-'));
    const javaHome = path.join(fixture, 'jdk');
    const javaName = process.platform === 'win32' ? 'java.exe' : 'java';
    await mkdir(path.join(javaHome, 'bin'), { recursive: true });
    await writeFile(path.join(javaHome, 'bin', javaName), 'fixture');
    const discovered = await discoverJava({
      env: { JAVA_HOME: javaHome },
      homeDirectory: path.join(fixture, 'home'),
      platform: process.platform === 'win32' ? 'win32' : 'linux',
      probe: async () => ({ major: 24, version: '24.0.1' }),
      projectYear: 2026,
      publicDirectory: path.join(fixture, 'public'),
    });
    expect(discovered.selected).toBeUndefined();
    expect(discovered.diagnostics.at(-1)).toContain('No compatible Java 17');
  });

  it('models official install roots and year requirements', () => {
    expect(wpilibRoots('win32', 'C:\\Users\\robot', 'C:\\Users\\Public')[0]).toContain(
      path.join('Users', 'Public', 'wpilib'),
    );
    expect(wpilibRoots('darwin', '/Users/robot', '/Users/Shared')).toEqual([
      path.resolve('/Users/robot/wpilib'),
    ]);
    expect(requiredJavaMajor(2026)).toBe(17);
  });
});

describe('process and Gradle abstraction', () => {
  it('streams logs and returns exit status', async () => {
    const logs: string[] = [];
    const result = await runProcess({
      args: ['-e', "process.stdout.write('out'); process.stderr.write('err')"],
      command: process.execPath,
      cwd: process.cwd(),
      onLog: (event) => logs.push(`${event.stream}:${event.text}`),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('out');
    expect(result.stderr).toBe('err');
    expect(logs).toContain('stdout:out');
    expect(logs).toContain('stderr:err');
  });

  it('supports timeout and AbortSignal cancellation', async () => {
    const timedOut = await runProcess({
      args: ['-e', 'setInterval(() => {}, 1000)'],
      command: process.execPath,
      cwd: process.cwd(),
      timeoutMs: 30,
    });
    expect(timedOut.timedOut).toBe(true);

    const controller = new AbortController();
    abortControllers.push(controller);
    const pending = runProcess({
      args: ['-e', 'setInterval(() => {}, 1000)'],
      command: process.execPath,
      cwd: process.cwd(),
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 30);
    const cancelled = await pending;
    expect(cancelled.cancelled).toBe(true);
  });

  it('builds platform-specific wrapper commands without a shell flag', () => {
    const windows = gradleInvocation('C:\\Robot Project', 'win32', ['tasks', '--dry-run']);
    expect(windows.command.toLowerCase()).toContain('cmd');
    expect(windows.args.join(' ')).toContain('gradlew.bat');
    const linux = gradleInvocation('/home/robot/project', 'linux', ['tasks']);
    expect(linux.command).toBe('/home/robot/project/gradlew');
    expect(linux.args).toEqual(['tasks']);
  });
});

describe('Gradle diagnostics', () => {
  it('extracts Java and Gradle file locations', () => {
    const diagnostics = parseGradleDiagnostics(`
C:\\robot\\src\\main\\java\\frc\\robot\\Robot.java:42:17: error: cannot find symbol
/tmp/RobotContainer.java:18: warning: unchecked conversion
Build file '/tmp/robot/build.gradle' line: 12
> Could not find method badConfig()
`);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        column: 17,
        file: 'C:\\robot\\src\\main\\java\\frc\\robot\\Robot.java',
        line: 42,
        message: 'cannot find symbol',
        severity: 'error',
      }),
      expect.objectContaining({ line: 18, severity: 'warning' }),
      expect.objectContaining({ file: '/tmp/robot/build.gradle', line: 12 }),
    ]);
  });
});
