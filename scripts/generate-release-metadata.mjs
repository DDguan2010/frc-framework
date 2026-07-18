import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const artifactRoot = path.resolve(repositoryRoot, process.argv[2] ?? 'apps/desktop/out/make');
const outputRoot = path.resolve(
  repositoryRoot,
  process.argv[3] ?? `output/release/${process.platform}-${process.arch}`,
);

const artifactFiles = await filesBelow(artifactRoot);
if (artifactFiles.length === 0) {
  throw new Error(`No release artifacts were found below ${artifactRoot}. Run pnpm make first.`);
}

const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, 'apps/desktop/package.json'), 'utf8'),
);
const licenseReport = productionLicenses();
const packages = Object.entries(licenseReport)
  .flatMap(([license, entries]) =>
    entries.flatMap((entry) =>
      entry.versions.map((version) => ({
        description: entry.description,
        homepage: entry.homepage,
        license,
        name: entry.name,
        version,
      })),
    ),
  )
  .sort((left, right) =>
    `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`),
  );

await mkdir(outputRoot, { recursive: true });
await writeFile(
  path.join(outputRoot, 'THIRD_PARTY_LICENSES.json'),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), packages }, null, 2)}\n`,
  'utf8',
);
await writeFile(
  path.join(outputRoot, 'sbom.spdx.json'),
  `${JSON.stringify(spdxDocument(packageJson, packages), null, 2)}\n`,
  'utf8',
);

const checksums = [];
for (const file of artifactFiles) {
  const digest = createHash('sha256')
    .update(await readFile(file))
    .digest('hex');
  checksums.push(`${digest}  ${path.relative(artifactRoot, file).replaceAll('\\', '/')}`);
}
await writeFile(path.join(outputRoot, 'SHA256SUMS'), `${checksums.sort().join('\n')}\n`, 'utf8');

process.stdout.write(
  `Generated SHA-256, SPDX SBOM, and license metadata for ${String(artifactFiles.length)} artifacts in ${outputRoot}.\n`,
);

function productionLicenses() {
  const pnpmCli = process.env.npm_execpath;
  if (pnpmCli === undefined) throw new Error('Run this script through pnpm release:metadata.');
  const result = spawnSync(process.execPath, [pnpmCli, 'licenses', 'list', '--prod', '--json'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    shell: false,
  });
  if (result.status !== 0)
    throw new Error(result.stderr || 'Unable to collect dependency licenses.');
  return JSON.parse(result.stdout);
}

function spdxDocument(app, dependencies) {
  const appId = 'SPDXRef-FRC-Framework';
  return {
    SPDXID: 'SPDXRef-DOCUMENT',
    creationInfo: {
      created: new Date().toISOString(),
      creators: ['Tool: FRC Framework release metadata generator'],
      licenseListVersion: '3.26',
    },
    dataLicense: 'CC0-1.0',
    documentNamespace: `https://github.com/DDguan2010/frc-framework/sbom/${app.version}/${randomUUID()}`,
    name: `FRC-Framework-${app.version}`,
    packages: [
      {
        SPDXID: appId,
        downloadLocation: 'NOASSERTION',
        filesAnalyzed: false,
        licenseConcluded: 'NOASSERTION',
        licenseDeclared: 'NOASSERTION',
        name: app.productName,
        versionInfo: app.version,
      },
      ...dependencies.map((dependency, index) => ({
        SPDXID: `SPDXRef-Dependency-${String(index + 1)}`,
        downloadLocation: dependency.homepage ?? 'NOASSERTION',
        filesAnalyzed: false,
        licenseConcluded: dependency.license,
        licenseDeclared: dependency.license,
        name: dependency.name,
        ...(dependency.description === undefined ? {} : { summary: dependency.description }),
        versionInfo: dependency.version,
      })),
    ],
    relationships: dependencies.map((_dependency, index) => ({
      relatedSpdxElement: `SPDXRef-Dependency-${String(index + 1)}`,
      relationshipType: 'DEPENDS_ON',
      spdxElementId: appId,
    })),
    spdxVersion: 'SPDX-2.3',
  };
}

async function filesBelow(root) {
  try {
    if (!(await stat(root)).isDirectory()) return [];
  } catch {
    return [];
  }
  const output = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...(await filesBelow(target)));
    else if (entry.isFile()) output.push(target);
  }
  return output.sort();
}
