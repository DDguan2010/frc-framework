import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { EditorConfiguration, EditorCandidate, EditorOpenRequest } from '../shared/ipc.js';

export async function detectEditors(): Promise<readonly EditorCandidate[]> {
  const candidates = editorCandidates();
  const result: EditorCandidate[] = [];
  for (const candidate of candidates) {
    if (await executableExists(candidate.executable)) {
      result.push(candidate);
    }
  }
  return deduplicate(result);
}

export async function validateEditor(configuration: EditorConfiguration): Promise<void> {
  if (!(await executableExists(configuration.executable))) {
    throw new Error(`Editor executable does not exist: ${configuration.executable}`);
  }
  for (const argument of configuration.arguments) {
    if (/[\0\r\n]/u.test(argument)) {
      throw new Error('Editor arguments must be single-line strings.');
    }
    const placeholders = argument.match(/\{[^}]+\}/gu) ?? [];
    if (
      placeholders.some((value) => !['{file}', '{line}', '{column}', '{project}'].includes(value))
    ) {
      throw new Error(`Unsupported editor placeholder in ${argument}.`);
    }
  }
}

export async function openEditor(
  configuration: EditorConfiguration,
  request: EditorOpenRequest,
): Promise<number | undefined> {
  await validateEditor(configuration);
  const values = {
    column: String(request.column ?? 1),
    file: request.file,
    line: String(request.line ?? 1),
    project: request.project,
  };
  const args = configuration.arguments.map((argument) =>
    argument.replace(
      /\{(file|line|column|project)\}/gu,
      (_, key: keyof typeof values) => values[key],
    ),
  );
  const child = spawn(configuration.executable, args, {
    cwd: request.project,
    detached: true,
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
  return child.pid;
}

function editorCandidates(): readonly EditorCandidate[] {
  const home = os.homedir();
  const year = '2026';
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local');
    const programs = process.env.ProgramFiles ?? 'C:\\Program Files';
    const publicDirectory = process.env.PUBLIC ?? 'C:\\Users\\Public';
    return [
      candidate(
        'wpilib-vscode',
        'WPILib VS Code',
        path.join(publicDirectory, 'wpilib', year, 'vscode', 'Code.exe'),
        ['--goto', '{file}:{line}:{column}', '{project}'],
      ),
      candidate(
        'vscode',
        'Visual Studio Code',
        path.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe'),
        ['--goto', '{file}:{line}:{column}', '{project}'],
      ),
      candidate('cursor', 'Cursor', path.join(local, 'Programs', 'cursor', 'Cursor.exe'), [
        '--goto',
        '{file}:{line}:{column}',
        '{project}',
      ]),
      candidate(
        'idea',
        'IntelliJ IDEA',
        path.join(
          programs,
          'JetBrains',
          'IntelliJ IDEA Community Edition 2025.3',
          'bin',
          'idea64.exe',
        ),
        ['--line', '{line}', '{file}'],
      ),
    ];
  }
  if (process.platform === 'darwin') {
    return [
      candidate(
        'wpilib-vscode',
        'WPILib VS Code',
        path.join(
          home,
          'wpilib',
          year,
          'vscode',
          'Visual Studio Code.app',
          'Contents',
          'MacOS',
          'Electron',
        ),
        ['--goto', '{file}:{line}:{column}', '{project}'],
      ),
      candidate(
        'vscode',
        'Visual Studio Code',
        '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
        ['--goto', '{file}:{line}:{column}', '{project}'],
      ),
      candidate('cursor', 'Cursor', '/Applications/Cursor.app/Contents/MacOS/Cursor', [
        '--goto',
        '{file}:{line}:{column}',
        '{project}',
      ]),
      candidate('idea', 'IntelliJ IDEA', '/Applications/IntelliJ IDEA.app/Contents/MacOS/idea', [
        '--line',
        '{line}',
        '{file}',
      ]),
    ];
  }
  return [
    candidate(
      'wpilib-vscode',
      'WPILib VS Code',
      path.join(home, 'wpilib', year, 'vscode', 'code'),
      ['--goto', '{file}:{line}:{column}', '{project}'],
    ),
    candidate('vscode', 'Visual Studio Code', '/usr/bin/code', [
      '--goto',
      '{file}:{line}:{column}',
      '{project}',
    ]),
    candidate('cursor', 'Cursor', '/usr/bin/cursor', [
      '--goto',
      '{file}:{line}:{column}',
      '{project}',
    ]),
    candidate('idea', 'IntelliJ IDEA', '/usr/bin/idea', ['--line', '{line}', '{file}']),
  ];
}

function candidate(
  id: string,
  name: string,
  executable: string,
  arguments_: readonly string[],
): EditorCandidate {
  return { arguments: arguments_, executable, id, name };
}

async function executableExists(executable: string): Promise<boolean> {
  try {
    await access(executable);
    return true;
  } catch {
    return false;
  }
}

function deduplicate(candidates: readonly EditorCandidate[]): readonly EditorCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = candidate.executable.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
