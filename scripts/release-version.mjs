const releaseVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

export function parseReleaseVersion(argumentsList) {
  const values = argumentsList.filter((argument) => argument !== '--');
  const requested = values.length === 1 ? values[0]?.trim().replace(/^v/u, '') : undefined;

  if (requested === undefined || !releaseVersionPattern.test(requested)) {
    throw new Error('Usage: pnpm release:version [--] <major.minor.patch[-prerelease]>');
  }

  return requested;
}
