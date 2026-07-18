import type { GradleDiagnostic } from './types.js';

const javaDiagnostic = /^(.*?\.java):(\d+)(?::(\d+))?:\s*([^:]+):\s*(.+)$/u;
const compilerDiagnostic = /^(.*?):\s*\[(\d+),(\d+)\]\s*(error|warning):\s*(.+)$/iu;
const gradleFileDiagnostic = /^Build file ['"](.+?)['"] line:\s*(\d+)$/iu;

export function parseGradleDiagnostics(output: string): readonly GradleDiagnostic[] {
  const result: GradleDiagnostic[] = [];
  let pendingBuildFile:
    { readonly file: string; readonly line: number; readonly raw: string } | undefined;
  for (const rawLine of output.split(/\r?\n/u)) {
    const line = stripAnsi(rawLine).trim();
    if (line.length === 0) {
      continue;
    }
    const java = line.match(javaDiagnostic);
    if (java !== null && java[1] !== undefined) {
      result.push({
        file: java[1],
        line: Number(java[2]),
        message: java[5] ?? 'Java compiler error',
        raw: rawLine,
        severity: isWarning(java[4]) ? 'warning' : 'error',
        ...(java[3] === undefined ? {} : { column: Number(java[3]) }),
      });
      continue;
    }
    const compiler = line.match(compilerDiagnostic);
    if (compiler !== null && compiler[1] !== undefined) {
      result.push({
        column: Number(compiler[3]),
        file: compiler[1],
        line: Number(compiler[2]),
        message: compiler[5] ?? 'Compiler error',
        raw: rawLine,
        severity: compiler[4]?.toLowerCase() === 'warning' ? 'warning' : 'error',
      });
      continue;
    }
    const buildFile = line.match(gradleFileDiagnostic);
    if (buildFile !== null && buildFile[1] !== undefined && buildFile[2] !== undefined) {
      pendingBuildFile = { file: buildFile[1], line: Number(buildFile[2]), raw: rawLine };
      continue;
    }
    if (
      pendingBuildFile !== undefined &&
      (line.startsWith('>') || line.startsWith('* What went wrong:'))
    ) {
      const message = line.replace(/^>\s*/u, '');
      if (!message.startsWith('*')) {
        result.push({
          file: pendingBuildFile.file,
          line: pendingBuildFile.line,
          message,
          raw: `${pendingBuildFile.raw}\n${rawLine}`,
          severity: 'error',
        });
        pendingBuildFile = undefined;
      }
    }
  }
  return result;
}

function stripAnsi(value: string): string {
  const escapeCharacter = String.fromCharCode(27);
  return value.replace(new RegExp(`${escapeCharacter}\\[[0-?]*[ -/]*[@-~]`, 'gu'), '');
}

function isWarning(label: string | undefined): boolean {
  return label !== undefined && /warning|warn|警告/iu.test(label);
}
