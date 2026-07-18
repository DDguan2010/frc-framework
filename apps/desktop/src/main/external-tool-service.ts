import { execFile, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { ExternalTool, ExternalToolConfiguration } from '../shared/ipc.js';

const execFileAsync = promisify(execFile);

export async function launchExternalTool(
  tool: ExternalTool,
  projectRoot: string,
  configuration: ExternalToolConfiguration = { mode: 'auto' },
): Promise<void> {
  const candidates =
    configuration.mode === 'custom' && configuration.executable?.trim().length
      ? [normalizeCustomExecutable(tool, configuration.executable.trim())]
      : externalToolCandidates(tool);
  const executable = await firstExisting(candidates);
  if (
    executable === undefined &&
    configuration.mode === 'auto' &&
    tool === 'pathplanner' &&
    process.platform === 'win32'
  ) {
    const appId = await windowsStorePathPlannerAppId();
    if (appId !== undefined) {
      await spawnDetached('explorer.exe', [`shell:AppsFolder\\${appId}`], projectRoot);
      return;
    }
  }
  if (executable === undefined) {
    throw new Error(
      `${toolName(tool)} was not found. ${configuration.mode === 'custom' ? 'Check the custom path in Settings.' : 'Choose a custom path in Settings or install the application.'} Checked: ${candidates.join(', ')}`,
    );
  }
  await spawnDetached(executable, [], projectRoot);
}

function normalizeCustomExecutable(tool: ExternalTool, selectedPath: string): string {
  if (process.platform === 'darwin' && /\.app[\\/]?$/iu.test(selectedPath)) {
    return path.join(selectedPath, 'Contents', 'MacOS', toolName(tool));
  }
  return selectedPath;
}

async function spawnDetached(
  executable: string,
  arguments_: readonly string[],
  projectRoot: string,
): Promise<void> {
  const child = spawn(executable, [...arguments_], {
    cwd: projectRoot,
    detached: true,
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  await new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

export function externalToolCandidates(tool: ExternalTool): readonly string[] {
  const home = os.homedir();
  const year = '2026';
  const name = tool === 'advantagescope' ? 'AdvantageScope' : 'PathPlanner';
  if (process.platform === 'win32') {
    const publicDirectory = process.env.PUBLIC ?? 'C:\\Users\\Public';
    const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
    return tool === 'advantagescope'
      ? [
          path.join(publicDirectory, 'wpilib', year, 'tools', 'AdvantageScope.exe'),
          path.join(
            publicDirectory,
            'wpilib',
            year,
            'advantagescope',
            'AdvantageScope (WPILib).exe',
          ),
          path.join(local, 'Programs', name, `${name}.exe`),
        ]
      : [
          path.join(local, 'Programs', name, `${name}.exe`),
          path.join(programFiles, name, `${name}.exe`),
          path.join(publicDirectory, 'wpilib', year, 'tools', `${name}.exe`),
        ];
  }
  if (process.platform === 'darwin') {
    return [
      `/Applications/${name}.app/Contents/MacOS/${name}`,
      path.join(home, 'Applications', `${name}.app`, 'Contents', 'MacOS', name),
    ];
  }
  return [
    `/usr/bin/${name.toLowerCase()}`,
    `/usr/local/bin/${name.toLowerCase()}`,
    path.join(home, '.local', 'bin', name.toLowerCase()),
  ];
}

function toolName(tool: ExternalTool): string {
  return tool === 'advantagescope' ? 'AdvantageScope' : 'PathPlanner';
}

async function firstExisting(candidates: readonly string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next deterministic candidate.
    }
  }
  return undefined;
}

async function windowsStorePathPlannerAppId(): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-StartApps | Where-Object { $_.Name -eq 'FRC PathPlanner' } | Select-Object -First 1 -ExpandProperty AppID",
      ],
      { encoding: 'utf8', timeout: 5_000, windowsHide: true },
    );
    const appId = stdout.trim();
    return /^[-.\w]+![\w.-]+$/u.test(appId) ? appId : undefined;
  } catch {
    return undefined;
  }
}
