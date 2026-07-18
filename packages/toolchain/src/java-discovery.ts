import { access, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { runProcess } from './process-runner.js';
import type {
  HostPlatform,
  JavaCandidate,
  JavaDiscoveryResult,
  JavaProbeResult,
  JavaSource,
} from './types.js';

export interface JavaDiscoveryOptions {
  readonly projectYear?: number;
  readonly explicitJavaHome?: string;
  readonly platform?: HostPlatform;
  readonly homeDirectory?: string;
  readonly publicDirectory?: string;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
  readonly probe?: (executable: string) => Promise<JavaProbeResult>;
}

interface CandidatePath {
  readonly home?: string;
  readonly executable: string;
  readonly source: JavaSource;
  readonly wpilibYear?: number;
}

export async function discoverJava(
  options: JavaDiscoveryOptions = {},
): Promise<JavaDiscoveryResult> {
  const platform = options.platform ?? normalizedPlatform(process.platform);
  const environment = options.env ?? process.env;
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const publicDirectory =
    options.publicDirectory ?? environment.PUBLIC ?? path.parse(homeDirectory).root;
  const probe = options.probe ?? probeJava;
  const requiredMajor = requiredJavaMajor(options.projectYear);
  const candidatePaths = await collectCandidatePaths({
    environment,
    homeDirectory,
    platform,
    publicDirectory,
    ...(options.explicitJavaHome === undefined
      ? {}
      : { explicitJavaHome: options.explicitJavaHome }),
    ...(options.projectYear === undefined ? {} : { projectYear: options.projectYear }),
  });

  const candidates: JavaCandidate[] = [];
  for (const candidate of deduplicateCandidates(candidatePaths, platform)) {
    try {
      const result = await probe(candidate.executable);
      const compatible = result.major === requiredMajor;
      candidates.push({
        ...candidate,
        compatible,
        diagnostic: compatible
          ? `${candidate.source} Java ${result.version} is compatible.`
          : `${candidate.source} Java ${result.version} is incompatible; Java ${requiredMajor} is required.`,
        major: result.major,
        valid: true,
        version: result.version,
        ...(result.vendor === undefined ? {} : { vendor: result.vendor }),
      });
    } catch (error) {
      candidates.push({
        ...candidate,
        compatible: false,
        diagnostic: `${candidate.source} Java could not be started: ${errorMessage(error)}`,
        valid: false,
      });
    }
  }

  const selected = candidates.find((candidate) => candidate.valid && candidate.compatible);
  const diagnostics = candidates.map((candidate) => candidate.diagnostic);
  if (selected === undefined) {
    diagnostics.push(
      `No compatible Java ${requiredMajor} runtime was found. Install WPILib for the project year or choose a JDK manually.`,
    );
  }
  return {
    candidates,
    diagnostics,
    ...(options.projectYear === undefined ? {} : { projectYear: options.projectYear }),
    requiredMajor,
    ...(selected === undefined ? {} : { selected }),
  };
}

export function requiredJavaMajor(projectYear?: number): number {
  // 2024–2026 GradleRIO projects use the Java 17 runtime bundled by WPILib.
  // Unknown future years remain conservative until their toolchain is catalogued.
  return projectYear === undefined || projectYear >= 2024 ? 17 : 11;
}

export function wpilibRoots(
  platform: HostPlatform,
  homeDirectory: string,
  publicDirectory: string,
): readonly string[] {
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const roots =
    platform === 'win32'
      ? [platformPath.join(publicDirectory, 'wpilib'), platformPath.join(homeDirectory, 'wpilib')]
      : [platformPath.join(homeDirectory, 'wpilib')];
  return [...new Set(roots.map((root) => platformPath.resolve(root)))];
}

export async function probeJava(executable: string): Promise<JavaProbeResult> {
  const result = await runProcess({
    args: ['-version'],
    command: executable,
    cwd: process.cwd(),
    timeoutMs: 5_000,
  });
  const output = `${result.stderr}\n${result.stdout}`;
  if (result.exitCode !== 0) {
    throw new Error(result.spawnError ?? output.trim() ?? `exit code ${String(result.exitCode)}`);
  }
  const match = output.match(/(?:java|openjdk) version ["']([^"']+)["']/i);
  if (match?.[1] === undefined) {
    throw new Error('unrecognized java -version output');
  }
  const version = match[1];
  const leading = Number.parseInt(version.split('.')[0] ?? '', 10);
  const major = leading === 1 ? Number.parseInt(version.split('.')[1] ?? '', 10) : leading;
  if (!Number.isInteger(major)) {
    throw new Error(`unrecognized Java version ${version}`);
  }
  const vendor = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => /(?:temurin|corretto|oracle|openjdk)/iu.test(line));
  return { major, version, ...(vendor === undefined ? {} : { vendor }) };
}

async function collectCandidatePaths(options: {
  readonly projectYear?: number;
  readonly explicitJavaHome?: string;
  readonly platform: HostPlatform;
  readonly homeDirectory: string;
  readonly publicDirectory: string;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
}): Promise<readonly CandidatePath[]> {
  const executableName = options.platform === 'win32' ? 'java.exe' : 'java';
  const result: CandidatePath[] = [];
  if (options.explicitJavaHome !== undefined) {
    result.push(javaHomeCandidate(options.explicitJavaHome, executableName, 'explicit'));
  }

  const wpilib: CandidatePath[] = [];
  for (const root of wpilibRoots(
    options.platform,
    options.homeDirectory,
    options.publicDirectory,
  )) {
    for (const year of await installedYears(root)) {
      const home = path.join(root, String(year), 'jdk');
      wpilib.push({
        executable: path.join(home, 'bin', executableName),
        home,
        source: 'wpilib',
        wpilibYear: year,
      });
    }
  }
  wpilib.sort((left, right) => {
    const leftMatch = left.wpilibYear === options.projectYear ? 1 : 0;
    const rightMatch = right.wpilibYear === options.projectYear ? 1 : 0;
    return rightMatch - leftMatch || (right.wpilibYear ?? 0) - (left.wpilibYear ?? 0);
  });
  result.push(...wpilib);

  if (options.environment.JAVA_HOME !== undefined) {
    result.push(javaHomeCandidate(options.environment.JAVA_HOME, executableName, 'java-home'));
  }
  const pathJava = await findPathJava(options.environment, options.platform, executableName);
  if (pathJava !== undefined) {
    result.push({ executable: pathJava, source: 'path' });
  }
  return result;
}

function javaHomeCandidate(
  home: string,
  executableName: string,
  source: JavaSource,
): CandidatePath {
  const normalizedHome = path.resolve(home);
  return {
    executable: path.join(normalizedHome, 'bin', executableName),
    home: normalizedHome,
    source,
  };
}

async function installedYears(root: string): Promise<readonly number[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^20\d{2}$/u.test(entry.name))
      .map((entry) => Number(entry.name));
  } catch {
    return [];
  }
}

async function findPathJava(
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: HostPlatform,
  executableName: string,
): Promise<string | undefined> {
  const pathValue = environment.PATH ?? environment.Path ?? environment.path;
  if (pathValue === undefined) {
    return undefined;
  }
  for (const directory of pathValue.split(path.delimiter)) {
    if (directory.trim().length === 0) {
      continue;
    }
    const candidate = path.join(directory.replace(/^"|"$/gu, ''), executableName);
    try {
      await access(candidate);
      return path.resolve(candidate);
    } catch {
      // Continue through PATH. Windows installations commonly contain stale javapath entries.
    }
  }
  if (platform !== normalizedPlatform(process.platform)) {
    return undefined;
  }
  return undefined;
}

function deduplicateCandidates(
  candidates: readonly CandidatePath[],
  platform: HostPlatform,
): readonly CandidatePath[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = platform === 'win32' ? candidate.executable.toLowerCase() : candidate.executable;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizedPlatform(value: NodeJS.Platform): HostPlatform {
  if (value === 'win32' || value === 'darwin') {
    return value;
  }
  return 'linux';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
