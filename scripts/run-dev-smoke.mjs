import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'frc-framework-vite-cold-'));
const cacheDirectory = path.join(temporaryRoot, 'renderer-cache');
const userDataDirectory = path.join(temporaryRoot, 'electron-user-data');
const pnpmEntry = process.env.npm_execpath;
if (pnpmEntry === undefined) {
  throw new Error('The development smoke test must be launched through pnpm.');
}
const startedAt = performance.now();
const child = spawn(
  process.execPath,
  [
    pnpmEntry,
    '--filter',
    '@frc-framework/desktop',
    'start',
    '--',
    '--dev-smoke-test',
    `--user-data-dir=${userDataDirectory}`,
  ],
  {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      FRC_FRAMEWORK_VITE_CACHE_DIR: cacheDirectory,
    },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdout += chunk;
});
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

const timeout = setTimeout(() => {
  child.kill();
}, 90_000);

child.once('error', async (error) => {
  clearTimeout(timeout);
  await rm(temporaryRoot, { force: true, recursive: true });
  process.stderr.write(`Unable to start the development application: ${error.message}\n`);
  process.exitCode = 1;
});

child.once('exit', async (code, signal) => {
  clearTimeout(timeout);
  await rm(temporaryRoot, { force: true, recursive: true });
  process.stdout.write(stdout);
  process.stderr.write(stderr);

  if (code !== 0 || !stdout.includes('DEV_SMOKE_OK')) {
    process.stderr.write(
      `Development cold-start smoke test failed with code ${String(code)} and signal ${String(signal)}.\n`,
    );
    process.exitCode = 1;
    return;
  }

  const elapsedMs = performance.now() - startedAt;
  process.stdout.write('Development application mounted its renderer from a cold Vite cache.\n');
  process.stdout.write(`DEV_COLD_STARTUP_MS=${elapsedMs.toFixed(1)}\n`);
});
