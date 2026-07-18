import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  isJavaPackage,
  validateModel,
  type FrcProjectModel,
  type ParameterValue,
} from '@frc-framework/domain';
import {
  PROJECT_SCHEMA,
  stringifyProjectYaml,
  type ProjectFileContent,
} from '@frc-framework/project-io';
import { collectTuningParameters } from '@frc-framework/nt-client';

import { generateStructuredFiles } from './structured-generator.js';

export interface TemplateContext {
  readonly PROJECT_ID: string;
  readonly PROJECT_NAME: string;
  readonly TEAM_NUMBER: string;
  readonly JAVA_PACKAGE: string;
  readonly JAVA_PACKAGE_PATH: string;
  readonly WPILIB_YEAR: string;
  readonly WPILIB_GRADLERIO_VERSION: string;
}

export interface GeneratedProject {
  readonly files: ReadonlyMap<string, ProjectFileContent>;
  readonly context: TemplateContext;
}

export interface GenerateProjectOptions {
  readonly templateRoot?: string;
}

const binaryExtensions = new Set(['.jar', '.png', '.jpg', '.jpeg', '.gif', '.glb', '.woff2']);

export async function generateProject(
  model: FrcProjectModel,
  options: GenerateProjectOptions = {},
): Promise<GeneratedProject> {
  const problems = validateModel(model).filter((problem) => problem.severity === 'error');
  if (problems.length > 0) {
    throw new Error(
      `Project model is invalid:\n${problems.map((problem) => `${problem.path}: ${problem.message}`).join('\n')}`,
    );
  }
  if (!isJavaPackage(model.project.javaPackage)) {
    throw new Error(`Invalid Java package: ${model.project.javaPackage}`);
  }
  const context = templateContext(model);
  const templateRoot = options.templateRoot ?? defaultTemplateRoot();
  const files = new Map<string, ProjectFileContent>();
  for (const sourcePath of await listFiles(templateRoot)) {
    const templateRelative = normalize(path.relative(templateRoot, sourcePath));
    const outputRelative = renderPath(templateRelative, context).replace(/\.template$/u, '');
    if (files.has(outputRelative)) {
      throw new Error(`Template produces duplicate output: ${outputRelative}`);
    }
    const extension = path.extname(sourcePath).toLowerCase();
    const content = binaryExtensions.has(extension)
      ? new Uint8Array(await readFile(sourcePath))
      : renderText(await readFile(sourcePath, 'utf8'), context);
    files.set(outputRelative, content);
  }

  files.set('project.yaml', stringifyProjectYaml(model));
  files.set('resources/project.schema.json', `${JSON.stringify(PROJECT_SCHEMA, null, 2)}\n`);
  files.set('AGENTS.md', agentsDocument(model));
  files.set('docs/ARCHITECTURE.md', architectureDocument(model));
  files.set('docs/ROBOT.md', robotDocument(model));
  files.set('docs/CONTROLS.md', controlsDocument(model));
  files.set('docs/TUNING.md', tuningDocument(model));
  for (const [filePath, content] of generateStructuredFiles(model)) {
    files.set(filePath, content);
  }

  const ordered = new Map(
    [...files.entries()].sort(([left], [right]) => left.localeCompare(right)),
  );
  validateGeneratedFiles(ordered);
  return { context, files: ordered };
}

export function templateContext(model: FrcProjectModel): TemplateContext {
  return {
    JAVA_PACKAGE: model.project.javaPackage,
    JAVA_PACKAGE_PATH: model.project.javaPackage.replace(/\./gu, '/'),
    PROJECT_ID: model.project.id,
    PROJECT_NAME: model.project.displayName,
    TEAM_NUMBER: String(model.project.teamNumber),
    WPILIB_GRADLERIO_VERSION: `${String(model.project.wpilibYear)}.2.1`,
    WPILIB_YEAR: String(model.project.wpilibYear),
  };
}

export function renderText(source: string, context: TemplateContext): string {
  return source.replace(/\{\{([A-Z0-9_]+)\}\}/gu, (token, key: string) => {
    const value = context[key as keyof TemplateContext];
    if (value === undefined) {
      throw new Error(`Unknown template variable ${token}.`);
    }
    return value;
  });
}

function renderPath(source: string, context: TemplateContext): string {
  return source.replace(/__JAVA_PACKAGE_PATH__/gu, context.JAVA_PACKAGE_PATH);
}

function validateGeneratedFiles(files: ReadonlyMap<string, ProjectFileContent>): void {
  for (const [filePath, content] of files) {
    if (path.isAbsolute(filePath) || filePath.split('/').includes('..')) {
      throw new Error(`Generated path is unsafe: ${filePath}`);
    }
    if (typeof content === 'string' && /\{\{[A-Z0-9_]+\}\}|__JAVA_PACKAGE_PATH__/u.test(content)) {
      throw new Error(`Unresolved template variable in ${filePath}.`);
    }
  }
}

async function listFiles(directory: string): Promise<readonly string[]> {
  const result: string[] = [];
  const visit = async (current: string): Promise<void> => {
    const entries = await readdir(current, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(child);
      } else if (entry.isFile()) {
        result.push(child);
      }
    }
  };
  await visit(directory);
  return result;
}

function defaultTemplateRoot(): string {
  return path.resolve(import.meta.dirname, '..', '..', '..', 'resources', 'base-template');
}

function agentsDocument(model: FrcProjectModel): string {
  return `# AGENTS.md

This is a WPILib ${String(model.project.wpilibYear)} Java command-based robot project for FRC team ${String(model.project.teamNumber)}.

Read these files before changing robot code:

- \`docs/ARCHITECTURE.md\` — package ownership and code placement rules;
- \`docs/ROBOT_OVERVIEW.md\` — generated robot structure and current overview;
- \`docs/CONTROL_BINDINGS.md\` — controllers and command bindings;
- \`docs/TUNING.md\` — tunable parameters and NetworkTables paths;
- \`project.yaml\` — structured project model used by FRC Framework.

Keep \`RobotContainer\` as a small composition root. Put controller triggers in \`controls/OperatorInterface\`, cross-subsystem command factories in \`commands/RobotCommands\`, local mechanism commands with their subsystem, autonomous composition under \`auto\`, and dashboard/field output under \`telemetry\`.

Do not edit generated files or blocks marked \`<frc-framework:managed>\` without also updating \`project.yaml\`. Custom Java outside managed blocks is intentionally preserved. Run \`./gradlew spotlessApply compileJava test\` after code changes.
`;
}

function architectureDocument(model: FrcProjectModel): string {
  return `# Architecture

Project: ${model.project.displayName}<br>
Java package: \`${model.project.javaPackage}\`

\`Robot\` owns WPILib lifecycle. \`RobotContainer\` constructs and connects components. The package boundaries are:

- \`controls\`: controller providers and bindings;
- \`commands\`: commands coordinating multiple subsystems;
- \`auto\`: manager, reusable actions, routines, and parameters;
- \`telemetry\`: Field2d, dashboards, and diagnostics;
- \`subsystems\`: mechanism-local IO, states, and commands;
- \`lib.ironpulse\`: reusable real/sim IO and mechanism building blocks;
- \`src/ext/lib/ntext\`: compile-time NetworkTables parameter generation.

The Java project builds without FRC Framework. \`project.yaml\` adds structured editing but is not a runtime dependency.
`;
}

function robotDocument(model: FrcProjectModel): string {
  return `# Robot

This file is generated from \`project.yaml\` and may be extended with team notes.

## Subsystems and mechanisms

${model.subsystems.length === 0 ? '_No mechanisms are configured._' : model.subsystems.map((item) => `- **${item.displayName}** (\`${item.symbol}\`)`).join('\n')}

## Devices

${model.devices.length === 0 ? '_No devices are configured._' : model.devices.map((item) => `- **${item.displayName}** — ${item.vendor} ${item.model}${item.canId === undefined ? '' : `, CAN ${String(item.canId)} on ${item.canBus ?? 'rio'}`}`).join('\n')}
`;
}

function controlsDocument(model: FrcProjectModel): string {
  return `# Controls

${model.controllers.length === 0 ? '_No controllers are configured._' : model.controllers.map((item) => `- **${item.displayName}** — ${item.provider}, port ${String(item.port)}, role ${item.role}`).join('\n')}

${model.bindings.length === 0 ? '_No bindings are configured._' : model.bindings.map((item) => `- \`${item.input}\` → ${item.commandId ?? item.codeReference ?? 'custom logic'} (${item.behavior})`).join('\n')}
`;
}

function tuningDocument(model: FrcProjectModel): string {
  const parameters = collectTuningParameters(model);
  return `# Tuning

NetworkTables root: \`${model.networkTables.rootPath}\`<br>
Live tuning enabled in the model: ${String(model.networkTables.enabled)}

Use FRC Framework's NT changes page to compare live values with code defaults before applying them. Explicit custom paths in \`project.yaml\` override generated paths.

## Published parameters

${parameters.length === 0 ? '_No parameters are published._' : parameters.map((entry) => `- **${entry.subsystemName} / ${entry.mechanismName} / ${entry.displayName}** — \`${entry.path}\`, default \`${formatMarkdownValue(entry.codeValue)}\`${entry.unit === undefined ? '' : ` ${entry.unit}`}, ${entry.writable ? 'tunable' : 'read-only'}`).join('\n')}
`;
}

function formatMarkdownValue(value: ParameterValue): string {
  return Array.isArray(value) ? value.join(', ') : String(value);
}

function normalize(value: string): string {
  return value.replace(/\\/gu, '/');
}
