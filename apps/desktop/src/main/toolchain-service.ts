import { randomUUID } from 'node:crypto';

import { discoverJava, runGradle, runProcess } from '@frc-framework/toolchain';

import type {
  ToolchainInfoView,
  ToolchainRunView,
  ToolchainSnapshotView,
  ToolchainTask,
} from '../shared/ipc.js';
import type { ProjectService } from './project-service.js';

const taskNames: Readonly<Record<ToolchainTask, readonly string[]>> = {
  compile: ['compileJava'],
  deploy: ['deploy'],
  simulate: ['simulateJava'],
  spotless: ['spotlessApply'],
  test: ['test'],
  validate: ['spotlessApply', 'compileJava'],
};

export class ToolchainService {
  readonly #projects: ProjectService;
  readonly #recent: ToolchainRunView[] = [];
  #active: ToolchainRunView | undefined;
  #abort: AbortController | undefined;

  constructor(projects: ProjectService) {
    this.#projects = projects;
  }

  async info(): Promise<ToolchainInfoView> {
    const context = this.#projects.toolchainContext();
    const { wpilibYear } = context;
    const result = await discoverJava({ projectYear: wpilibYear });
    const git = await gitStatus(context.projectRoot);
    const lastBuild = this.#recent.find((run) =>
      ['compile', 'test', 'validate', 'deploy'].includes(run.task),
    );
    return {
      candidates: result.candidates,
      diagnostics: result.diagnostics,
      projectYear: wpilibYear,
      requiredMajor: result.requiredMajor,
      deploy: {
        externallyModifiedFiles: context.externallyModifiedFiles,
        gitDirty: git.dirty,
        ...(git.branch === undefined ? {} : { gitBranch: git.branch }),
        ...(lastBuild?.finishedAt === undefined ? {} : { lastBuildAt: lastBuild.finishedAt }),
        ...(lastBuild === undefined ? {} : { lastBuildState: lastBuild.state }),
        pendingStructuredChanges: context.pendingStructuredChanges,
        target: `roboRIO-${String(context.teamNumber)}-FRC.local (10.${String(Math.floor(context.teamNumber / 100))}.${String(context.teamNumber % 100)}.2)`,
        teamNumber: context.teamNumber,
      },
      ...(result.selected === undefined ? {} : { selected: result.selected }),
    };
  }

  start(task: ToolchainTask, confirmed: boolean): ToolchainSnapshotView {
    if (!Object.hasOwn(taskNames, task)) throw new Error('Unknown Gradle task.');
    if (this.#active?.state === 'running')
      throw new Error('Another Gradle task is already running.');
    if (task === 'deploy' && !confirmed)
      throw new Error('Deploy requires explicit robot confirmation.');
    const run: ToolchainRunView = {
      diagnostics: [],
      id: randomUUID(),
      output: '',
      startedAt: new Date().toISOString(),
      state: 'running',
      task,
    };
    this.#active = run;
    this.#abort = new AbortController();
    void this.#execute(run, this.#abort.signal);
    return this.snapshot();
  }

  cancel(): ToolchainSnapshotView {
    this.#abort?.abort();
    return this.snapshot();
  }

  snapshot(): ToolchainSnapshotView {
    return {
      ...(this.#active === undefined ? {} : { active: structuredClone(this.#active) }),
      recent: structuredClone(this.#recent),
    };
  }

  dispose(): void {
    this.#abort?.abort();
  }

  async #execute(initial: ToolchainRunView, signal: AbortSignal): Promise<void> {
    const started = Date.now();
    try {
      const { projectRoot, wpilibYear } = this.#projects.toolchainContext();
      const java = await discoverJava({ projectYear: wpilibYear });
      if (java.selected === undefined) throw new Error(java.diagnostics.join('\n'));
      const result = await runGradle({
        java: java.selected,
        onLog: (event) => {
          const active = this.#active;
          if (active?.id !== initial.id) return;
          this.#active = { ...active, output: appendOutput(active.output, event.text) };
        },
        projectRoot,
        signal,
        tasks: taskNames[initial.task],
        timeoutMs: initial.task === 'deploy' || initial.task === 'simulate' ? 600_000 : 300_000,
      });
      this.#finish(
        initial.id,
        {
          diagnostics: result.diagnostics,
          output: appendOutput(this.#active?.output ?? '', result.stderr),
          state: result.cancelled ? 'cancelled' : result.success ? 'success' : 'failed',
        },
        started,
      );
    } catch (error) {
      this.#finish(
        initial.id,
        {
          diagnostics: [],
          output: appendOutput(
            this.#active?.output ?? '',
            error instanceof Error ? error.message : String(error),
          ),
          state: signal.aborted ? 'cancelled' : 'failed',
        },
        started,
      );
    }
  }

  #finish(
    id: string,
    changes: Pick<ToolchainRunView, 'diagnostics' | 'output' | 'state'>,
    started: number,
  ): void {
    if (this.#active?.id !== id) return;
    const completed: ToolchainRunView = {
      ...this.#active,
      ...changes,
      durationMs: Date.now() - started,
      finishedAt: new Date().toISOString(),
    };
    this.#active = completed;
    this.#recent.unshift(completed);
    this.#recent.splice(20);
    this.#abort = undefined;
  }
}

async function gitStatus(projectRoot: string): Promise<{
  readonly branch?: string;
  readonly dirty: boolean;
}> {
  const result = await runProcess({
    args: ['status', '--porcelain=v1', '--branch'],
    command: 'git',
    cwd: projectRoot,
    timeoutMs: 5_000,
  });
  if (result.exitCode !== 0 || result.spawnError !== undefined) return { dirty: false };
  const lines = result.stdout.split(/\r?\n/gu).filter(Boolean);
  const heading = lines[0]?.startsWith('## ') === true ? lines.shift()?.slice(3) : undefined;
  return {
    ...(heading === undefined ? {} : { branch: heading.split('...')[0] }),
    dirty: lines.length > 0,
  };
}

function appendOutput(current: string, addition: string): string {
  const combined = `${current}${addition}`;
  return combined.length <= 200_000 ? combined : combined.slice(-200_000);
}
