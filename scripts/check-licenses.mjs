import { spawnSync } from 'node:child_process';

const allowedLicenses = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MIT',
  'Python-2.0',
  'Unlicense',
]);

const pnpmCli = process.env.npm_execpath;
if (pnpmCli === undefined) {
  process.stderr.write('Run this audit through the pnpm licenses:check script.\n');
  process.exit(1);
}

const result = spawnSync(process.execPath, [pnpmCli, 'licenses', 'list', '--prod', '--json'], {
  encoding: 'utf8',
  shell: false,
});

if (result.status !== 0) {
  process.stderr.write(
    result.stderr || result.error?.message || 'Unable to read production dependency licenses.\n',
  );
  process.exit(result.status ?? 1);
}

const report = JSON.parse(result.stdout);
const discoveredLicenses = Object.keys(report).sort();
const rejectedLicenses = discoveredLicenses.filter((license) => !allowedLicenses.has(license));

if (rejectedLicenses.length > 0) {
  process.stderr.write(`Unreviewed production licenses: ${rejectedLicenses.join(', ')}\n`);
  process.exit(1);
}

const packageCount = Object.values(report).reduce((total, packages) => total + packages.length, 0);
process.stdout.write(
  `Verified ${packageCount} production packages across ${discoveredLicenses.length} licenses.\n`,
);
