export interface ImportEditResult {
  readonly changed: boolean;
  readonly source: string;
}

export class UnsafeImportEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeImportEditError';
  }
}

export function addJavaImport(
  source: string,
  importName: string,
  options: { readonly isStatic?: boolean } = {},
): ImportEditResult {
  validateImportName(importName);
  const isStatic = options.isStatic ?? false;
  const importPattern = /^import\s+(static\s+)?([\w.]+(?:\.\*)?)\s*;[\t ]*$/gm;
  const matches = [...source.matchAll(importPattern)];
  const requestedKey = `${isStatic ? 'static ' : ''}${importName}`;
  const existingKeys = matches.map(
    (match) => `${match[1] === undefined ? '' : 'static '}${match[2] ?? ''}`,
  );
  if (existingKeys.includes(requestedKey)) {
    return { changed: false, source };
  }

  const lineEnding = source.includes('\r\n') ? '\r\n' : '\n';
  const imports = [...existingKeys, requestedKey];
  const importBlock = formatImports(imports, lineEnding);

  if (matches.length > 0) {
    const first = matches[0];
    const last = matches.at(-1);
    if (first?.index === undefined || last?.index === undefined) {
      throw new UnsafeImportEditError('Unable to determine the existing import block range.');
    }
    const blockEnd = last.index + last[0].length;
    const existingBlock = source.slice(first.index, blockEnd);
    const unexplainedText = existingBlock.replace(importPattern, '').trim();
    if (unexplainedText.length > 0) {
      throw new UnsafeImportEditError(
        'The import block contains comments or custom text and cannot be safely reordered.',
      );
    }
    return {
      changed: true,
      source: `${source.slice(0, first.index)}${importBlock}${source.slice(blockEnd)}`,
    };
  }

  const packageMatch = /^package\s+[\w.]+\s*;[\t ]*$/m.exec(source);
  if (packageMatch?.index !== undefined) {
    const insertionPoint = packageMatch.index + packageMatch[0].length;
    return {
      changed: true,
      source: `${source.slice(0, insertionPoint)}${lineEnding}${lineEnding}${importBlock}${source.slice(insertionPoint)}`,
    };
  }

  return { changed: true, source: `${importBlock}${lineEnding}${lineEnding}${source}` };
}

function formatImports(imports: readonly string[], lineEnding: string): string {
  const normal = imports
    .filter((value) => !value.startsWith('static '))
    .map((value) => `import ${value};`)
    .sort();
  const staticImports = imports
    .filter((value) => value.startsWith('static '))
    .map((value) => `import ${value};`)
    .sort();
  return [
    ...normal,
    ...(normal.length > 0 && staticImports.length > 0 ? [''] : []),
    ...staticImports,
  ].join(lineEnding);
}

function validateImportName(importName: string): void {
  if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\.\*)+$/.test(importName)) {
    throw new TypeError(`Invalid Java import: ${importName}`);
  }
}
