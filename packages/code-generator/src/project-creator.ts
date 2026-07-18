import { chmod, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import type { FrcProjectModel } from '@frc-framework/domain';
import { applyFileTransaction } from '@frc-framework/project-io';
import {
  discoverJava,
  runGradle,
  type JavaDiscoveryResult,
  type ProcessLogEvent,
} from '@frc-framework/toolchain';

import {
  generateProject,
  type GenerateProjectOptions,
  type GeneratedProject,
} from './generator.js';

export interface CreateProjectOptions extends GenerateProjectOptions {
  readonly projectRoot: string;
  readonly model: FrcProjectModel;
  readonly validateBuild?: boolean;
  readonly onLog?: (event: ProcessLogEvent) => void;
}

export interface CreatedProject {
  readonly generated: GeneratedProject;
  readonly toolchain?: JavaDiscoveryResult;
}

export async function createProject(options: CreateProjectOptions): Promise<CreatedProject> {
  const existing = await readdir(options.projectRoot);
  if (existing.length > 0) {
    throw new Error('Project creation requires an empty directory.');
  }
  let generated = await generateProject(options.model, options);
  await applyFileTransaction(options.projectRoot, generated.files);
  if (process.platform !== 'win32') {
    await chmod(path.join(options.projectRoot, 'gradlew'), 0o755);
  }
  if (options.validateBuild === false) {
    return { generated };
  }

  const toolchain = await discoverJava({ projectYear: options.model.project.wpilibYear });
  const java = toolchain.selected;
  if (java === undefined) {
    await rollbackCreatedProject(options.projectRoot, generated);
    throw new Error(toolchain.diagnostics.join('\n'));
  }
  const validation = await runGradle({
    java,
    projectRoot: options.projectRoot,
    tasks: ['spotlessApply', 'compileJava', 'test'],
    timeoutMs: 600_000,
    ...(options.onLog === undefined ? {} : { onLog: options.onLog }),
  });
  if (!validation.success) {
    await rollbackCreatedProject(options.projectRoot, generated);
    throw new Error(
      `Generated project validation failed.\n${validation.stdout}\n${validation.stderr}`,
    );
  }
  generated = await refreshGeneratedTextFiles(options.projectRoot, generated);
  return { generated, toolchain };
}

async function refreshGeneratedTextFiles(
  root: string,
  generated: GeneratedProject,
): Promise<GeneratedProject> {
  const files = new Map(generated.files);
  for (const [filePath, content] of generated.files) {
    if (typeof content === 'string') {
      files.set(filePath, await readFile(path.join(root, filePath), 'utf8'));
    }
  }
  return { ...generated, files };
}

async function rollbackCreatedProject(root: string, generated: GeneratedProject): Promise<void> {
  await applyFileTransaction(
    root,
    new Map([...generated.files.keys()].map((filePath) => [filePath, null])),
  );
  await rm(path.join(root, '.frc-framework'), { force: true, recursive: true });
  for (const directory of [
    'src',
    'gradle',
    'vendordeps',
    'resources',
    'docs',
    '.wpilib',
    '.gradle',
    'build',
  ]) {
    await rm(path.join(root, directory), { force: true, recursive: true });
  }
}
