import { spawn } from 'node:child_process';

import type { ProcessResult, ProcessSpec } from './types.js';

const DEFAULT_TIMEOUT_MS = 120_000;

export async function runProcess(spec: ProcessSpec): Promise<ProcessResult> {
  const args = [...(spec.args ?? [])];
  const startedAt = Date.now();
  let stdout = '';
  let stderr = '';
  let cancelled = spec.signal?.aborted === true;
  let timedOut = false;
  let spawnError: string | undefined;

  if (cancelled) {
    return {
      args,
      cancelled: true,
      command: spec.command,
      durationMs: 0,
      exitCode: null,
      signal: null,
      stderr,
      stdout,
      timedOut,
    };
  }

  return new Promise<ProcessResult>((resolve) => {
    const child = spawn(spec.command, args, {
      cwd: spec.cwd,
      env: { ...process.env, ...spec.env },
      shell: false,
      windowsVerbatimArguments: spec.windowsVerbatimArguments ?? false,
      windowsHide: true,
    });

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
      clearTimeout(timeout);
      spec.signal?.removeEventListener('abort', abort);
      resolve({
        args,
        cancelled,
        command: spec.command,
        durationMs: Date.now() - startedAt,
        exitCode,
        signal,
        ...(spawnError === undefined ? {} : { spawnError }),
        stderr,
        stdout,
        timedOut,
      });
    };

    const stop = (): void => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    };
    const abort = (): void => {
      cancelled = true;
      stop();
    };
    spec.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      spec.onLog?.({ stream: 'stdout', text: chunk });
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      spec.onLog?.({ stream: 'stderr', text: chunk });
    });
    child.on('error', (error) => {
      spawnError = error.message;
    });
    child.on('close', finish);
  });
}
