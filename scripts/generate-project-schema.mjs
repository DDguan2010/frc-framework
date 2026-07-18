import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { PROJECT_SCHEMA } from '../packages/project-io/src/project-schema.ts';

const output = path.resolve('resources', 'project.schema.json');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(PROJECT_SCHEMA, null, 2)}\n`, 'utf8');
process.stdout.write(`Generated ${output}\n`);
