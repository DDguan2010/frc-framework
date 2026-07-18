import { copyFile, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { FrcProjectModel } from '@frc-framework/domain';
import Ajv, { type ErrorObject } from 'ajv';
import { Document, isMap, parseDocument } from 'yaml';

import { PROJECT_SCHEMA } from './project-schema.js';

const topLevelOrder = [
  'schemaVersion',
  'project',
  'robot',
  'subsystems',
  'devices',
  'controllers',
  'bindings',
  'commands',
  'autos',
  'networkTables',
  'docs',
  'presets',
  'tuningHistory',
  'tuningSnapshots',
  'unmanagedFiles',
] as const;

const ajv = new Ajv({ allErrors: true, allowUnionTypes: true, strict: false });
ajv.addFormat(
  'uuid',
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
);
const validate = ajv.compile(PROJECT_SCHEMA);
const MAX_MIGRATION_BACKUPS = 5;

export interface ProjectSchemaProblem {
  readonly path: string;
  readonly message: string;
  readonly keyword: string;
  readonly entityId?: string;
}

export interface ParsedProjectYaml {
  readonly document: Document;
  readonly model?: FrcProjectModel;
  readonly problems: readonly ProjectSchemaProblem[];
  readonly unknownTopLevelKeys: readonly string[];
}

export interface ProjectMigrationPreview {
  readonly required: boolean;
  readonly supported: boolean;
  readonly fromVersion: number | 'unversioned';
  readonly toVersion: 1;
  readonly summary: readonly string[];
}

export async function inspectProjectYamlMigration(
  filePath: string,
): Promise<ProjectMigrationPreview> {
  const document = parseDocument(await readFile(filePath, 'utf8'));
  if (document.errors.length > 0) {
    return {
      fromVersion: 'unversioned',
      required: false,
      summary: [],
      supported: false,
      toVersion: 1,
    };
  }
  const value = document.toJS() as Record<string, unknown> | null;
  const raw = value?.schemaVersion ?? value?.version;
  if (raw === 1) {
    return { fromVersion: 1, required: false, summary: [], supported: true, toVersion: 1 };
  }
  const supported = raw === 0 || raw === undefined;
  return {
    fromVersion: typeof raw === 'number' ? raw : 'unversioned',
    required: true,
    summary: supported
      ? [
          'Create a timestamped project.yaml backup.',
          'Set schemaVersion to 1 and retain unknown fields.',
          'Initialize missing structured collections, tuning history, and snapshots.',
        ]
      : [`Schema version ${String(raw)} is newer than this application supports.`],
    supported,
    toVersion: 1,
  };
}

export function parseProjectYaml(source: string): ParsedProjectYaml {
  const document = parseDocument(source, {
    keepSourceTokens: true,
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    return {
      document,
      problems: document.errors.map((error) => ({
        keyword: 'yaml-syntax',
        message: error.message,
        path: '/',
      })),
      unknownTopLevelKeys: [],
    };
  }
  const value: unknown = document.toJS({ maxAliasCount: 20 });
  if (isRecord(value) && isRecord(value.project) && value.project.baseVersion === undefined) {
    value.project.baseVersion = 1;
  }
  if (isRecord(value) && !Array.isArray(value.unmanagedFiles)) value.unmanagedFiles = [];
  if (!validate(value)) {
    return {
      document,
      problems: (validate.errors ?? []).map((error) => schemaProblem(error, value)),
      unknownTopLevelKeys: unknownKeys(value),
    };
  }
  if (isRecord(value)) {
    if (!Array.isArray(value.presets)) value.presets = [];
    if (!Array.isArray(value.tuningHistory)) value.tuningHistory = [];
    if (!Array.isArray(value.tuningSnapshots)) value.tuningSnapshots = [];
    if (!Array.isArray(value.unmanagedFiles)) value.unmanagedFiles = [];
  }
  return {
    document,
    model: value as FrcProjectModel,
    problems: [],
    unknownTopLevelKeys: unknownKeys(value),
  };
}

export function stringifyProjectYaml(model: FrcProjectModel, existing?: Document): string {
  const document = existing?.clone() ?? new Document();
  if (!isMap(document.contents)) {
    document.contents = document.createNode({});
  }
  for (const key of topLevelOrder) {
    document.set(key, structuredClone(model[key]));
  }
  document.commentBefore ??=
    'yaml-language-server: $schema=resources/project.schema.json\nFRC Framework project model. Unknown fields and comments are preserved.';
  return document.toString({ lineWidth: 0 });
}

export async function loadProjectYaml(filePath: string): Promise<ParsedProjectYaml> {
  return parseProjectYaml(await readFile(filePath, 'utf8'));
}

export async function writeProjectSchema(filePath: string): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(PROJECT_SCHEMA, null, 2)}\n`, 'utf8');
}

export async function migrateProjectYaml(filePath: string): Promise<{
  readonly backupPath?: string;
  readonly migrated: boolean;
  readonly source: string;
}> {
  const source = await readFile(filePath, 'utf8');
  const document = parseDocument(source);
  const value = document.toJS() as Record<string, unknown> | null;
  if (value === null || typeof value !== 'object') {
    return { migrated: false, source };
  }
  const version = value.schemaVersion ?? value.version;
  if (version === 1) {
    return { migrated: false, source };
  }
  if (version !== 0 && version !== undefined) {
    throw new Error(`Unsupported project schema version: ${String(version)}`);
  }
  const backupPath = `${filePath}.backup-${new Date().toISOString().replace(/[:.]/gu, '-')}`;
  await copyFile(filePath, backupPath);
  value.schemaVersion = 1;
  if (isRecord(value.project)) value.project.baseVersion = 1;
  delete value.version;
  for (const key of [
    'subsystems',
    'devices',
    'controllers',
    'bindings',
    'commands',
    'autos',
    'docs',
    'presets',
    'tuningHistory',
    'tuningSnapshots',
    'unmanagedFiles',
  ]) {
    value[key] ??= [];
  }
  value.networkTables ??= { enabled: true, rootPath: '/Tuning' };
  const migrated = new Document(value);
  migrated.commentBefore = 'Migrated to FRC Framework schemaVersion 1.';
  const temporary = path.join(path.dirname(filePath), `.${path.basename(filePath)}.migration.tmp`);
  await writeFile(temporary, migrated.toString({ lineWidth: 0 }), 'utf8');
  await rename(temporary, filePath);
  await pruneMigrationBackups(filePath).catch(() => undefined);
  return { backupPath, migrated: true, source: migrated.toString({ lineWidth: 0 }) };
}

async function pruneMigrationBackups(filePath: string): Promise<void> {
  const directory = path.dirname(filePath);
  const prefix = `${path.basename(filePath)}.backup-`;
  const backups = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.startsWith(prefix))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));
  await Promise.all(
    backups
      .slice(MAX_MIGRATION_BACKUPS)
      .map((name) => rm(path.join(directory, name), { force: true })),
  );
}

function schemaProblem(error: ErrorObject, root: unknown): ProjectSchemaProblem {
  const path = error.instancePath.length === 0 ? '/' : error.instancePath;
  const entityId = findEntityId(root, path);
  return {
    keyword: error.keyword,
    message: `${path}: ${error.message ?? 'invalid value'}`,
    path,
    ...(entityId === undefined ? {} : { entityId }),
  };
}

function findEntityId(root: unknown, pointer: string): string | undefined {
  const segments = pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/gu, '/').replace(/~0/gu, '~'));
  let current: unknown = root;
  const visited: unknown[] = [root];
  for (const segment of segments) {
    if (Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      break;
    }
    visited.push(current);
  }
  for (const candidate of visited.reverse()) {
    if (isRecord(candidate) && typeof candidate.id === 'string') {
      return candidate.id;
    }
  }
  return undefined;
}

function unknownKeys(value: unknown): readonly string[] {
  if (!isRecord(value)) {
    return [];
  }
  return Object.keys(value).filter((key) => !(topLevelOrder as readonly string[]).includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
