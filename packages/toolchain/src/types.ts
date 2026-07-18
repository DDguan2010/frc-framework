export type HostPlatform = 'win32' | 'darwin' | 'linux';

export type JavaSource = 'explicit' | 'wpilib' | 'java-home' | 'path';

export interface JavaProbeResult {
  readonly major: number;
  readonly version: string;
  readonly vendor?: string;
}

export interface JavaCandidate {
  readonly home?: string;
  readonly executable: string;
  readonly source: JavaSource;
  readonly wpilibYear?: number;
  readonly version?: string;
  readonly major?: number;
  readonly vendor?: string;
  readonly valid: boolean;
  readonly compatible: boolean;
  readonly diagnostic: string;
}

export interface JavaDiscoveryResult {
  readonly selected?: JavaCandidate;
  readonly candidates: readonly JavaCandidate[];
  readonly requiredMajor: number;
  readonly projectYear?: number;
  readonly diagnostics: readonly string[];
}

export type ProcessStream = 'stdout' | 'stderr';

export interface ProcessLogEvent {
  readonly stream: ProcessStream;
  readonly text: string;
}

export interface ProcessSpec {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
  readonly timeoutMs?: number;
  readonly windowsVerbatimArguments?: boolean;
  readonly signal?: AbortSignal;
  readonly onLog?: (event: ProcessLogEvent) => void;
}

export interface ProcessResult {
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly cancelled: boolean;
  readonly timedOut: boolean;
  readonly spawnError?: string;
}

export interface GradleDiagnostic {
  readonly severity: 'error' | 'warning';
  readonly file?: string;
  readonly line?: number;
  readonly column?: number;
  readonly message: string;
  readonly raw: string;
}

export interface GradleRunOptions {
  readonly projectRoot: string;
  readonly tasks: readonly string[];
  readonly java?: JavaCandidate;
  readonly arguments?: readonly string[];
  readonly platform?: HostPlatform;
  readonly env?: Readonly<NodeJS.ProcessEnv>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly onLog?: (event: ProcessLogEvent) => void;
}

export interface GradleRunResult extends ProcessResult {
  readonly diagnostics: readonly GradleDiagnostic[];
  readonly success: boolean;
}
