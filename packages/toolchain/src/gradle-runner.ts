import path from 'node:path';

import { parseGradleDiagnostics } from './gradle-diagnostics.js';
import { runProcess } from './process-runner.js';
import type { GradleRunOptions, GradleRunResult, HostPlatform, ProcessSpec } from './types.js';

export async function runGradle(options: GradleRunOptions): Promise<GradleRunResult> {
  if (options.tasks.length === 0) {
    throw new TypeError('At least one Gradle task is required.');
  }
  for (const value of [...options.tasks, ...(options.arguments ?? [])]) {
    validateArgument(value);
  }
  const platform = options.platform ?? normalizedPlatform(process.platform);
  const invocation = gradleInvocation(options.projectRoot, platform, [
    ...options.tasks,
    '--console=plain',
    '--no-daemon',
    ...(options.arguments ?? []),
  ]);
  const environment: NodeJS.ProcessEnv = { ...options.env };
  if (options.java?.home !== undefined) {
    environment.JAVA_HOME = options.java.home;
    environment.PATH = `${path.join(options.java.home, 'bin')}${path.delimiter}${options.env?.PATH ?? process.env.PATH ?? ''}`;
  }
  const spec: ProcessSpec = {
    args: invocation.args,
    command: invocation.command,
    cwd: options.projectRoot,
    env: environment,
    ...(invocation.windowsVerbatimArguments === undefined
      ? {}
      : { windowsVerbatimArguments: invocation.windowsVerbatimArguments }),
    ...(options.onLog === undefined ? {} : { onLog: options.onLog }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };
  const result = await runProcess(spec);
  const diagnostics = parseGradleDiagnostics(`${result.stdout}\n${result.stderr}`);
  return {
    ...result,
    diagnostics,
    success: result.exitCode === 0 && !result.cancelled && !result.timedOut,
  };
}

export function gradleInvocation(
  projectRoot: string,
  platform: HostPlatform,
  args: readonly string[],
): {
  readonly command: string;
  readonly args: readonly string[];
  readonly windowsVerbatimArguments?: boolean;
} {
  if (platform === 'win32') {
    const wrapper = path.win32.join(projectRoot, 'gradlew.bat');
    const command = process.env.ComSpec ?? 'cmd.exe';
    return {
      args: ['/d', '/s', '/c', quoteWindowsCommand(wrapper, args)],
      command,
      windowsVerbatimArguments: true,
    };
  }
  return { args, command: path.posix.join(projectRoot, 'gradlew') };
}

function quoteWindowsCommand(command: string, args: readonly string[]): string {
  return `"${[command, ...args].map(quoteWindowsArgument).join(' ')}"`;
}

function quoteWindowsArgument(argument: string): string {
  // cmd.exe keeps metacharacters inert inside quotes. Backslashes before a quote
  // follow the CommandLineToArgvW escaping rules used by Gradle's batch wrapper.
  return `"${argument.replace(/(\\*)"/gu, '$1$1\\"').replace(/(\\+)$/u, '$1$1')}"`;
}

function validateArgument(value: string): void {
  if (value.length === 0 || /[\0\r\n]/u.test(value)) {
    throw new TypeError('Gradle arguments must be non-empty single-line strings.');
  }
}

function normalizedPlatform(value: NodeJS.Platform): HostPlatform {
  if (value === 'win32' || value === 'darwin') {
    return value;
  }
  return 'linux';
}
