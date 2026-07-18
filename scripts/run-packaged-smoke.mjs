import { spawn } from 'node:child_process';
import path from 'node:path';

const packageDirectory = path.resolve(
  `apps/desktop/out/FRC Framework-${process.platform}-${process.arch}`,
);
const startedAt = performance.now();

function executablePath() {
  if (process.platform === 'win32') {
    return path.join(packageDirectory, 'frc-framework.exe');
  }
  if (process.platform === 'darwin') {
    return path.join(packageDirectory, 'FRC Framework.app', 'Contents', 'MacOS', 'FRC Framework');
  }
  return path.join(packageDirectory, 'frc-framework');
}

const child = spawn(executablePath(), ['--smoke-test'], {
  cwd: packageDirectory,
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

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
}, 25_000);

child.once('error', (error) => {
  clearTimeout(timeout);
  process.stderr.write(`Unable to start packaged application: ${error.message}\n`);
  process.exitCode = 1;
});

child.once('exit', (code, signal) => {
  clearTimeout(timeout);
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  const elapsedMs = performance.now() - startedAt;

  if (code !== 0 || !stdout.includes('PACKAGED_SMOKE_OK')) {
    process.stderr.write(
      `Packaged smoke test failed with code ${String(code)} and signal ${String(signal)}.\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write('Packaged application loaded its secure renderer successfully.\n');
  process.stdout.write(`PACKAGED_STARTUP_MS=${elapsedMs.toFixed(1)}\n`);
});
