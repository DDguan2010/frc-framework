const managedBlock =
  /([ \t]*\/\/ <frc-framework:managed>\r?\n)[\s\S]*?([ \t]*\/\/ <\/frc-framework:managed>)/gu;
const userSupplement =
  /(<!-- frc-framework:user-supplement:start -->\r?\n)[\s\S]*?(<!-- frc-framework:user-supplement:end -->)/gu;
const importLine = /^import\s+(?:static\s+)?[\w.*]+;\s*$/gmu;

/** Preserves ordinary Java outside managed blocks and unions generated imports. */
export function mergeGeneratedJava(existing: string | undefined, generated: string): string {
  if (existing === undefined) return generated;
  const generatedBlocks = [...generated.matchAll(managedBlock)];
  const existingBlocks = [...existing.matchAll(managedBlock)];
  // Some preset implementations are generated as complete Java files rather
  // than mixed managed/custom regions. An unchanged file is already the exact
  // candidate we want and must not block unrelated structured edits.
  if (
    generatedBlocks.length === 0 &&
    existingBlocks.length === 0 &&
    sameJavaTokens(existing, generated)
  ) {
    return existing;
  }
  if (generatedBlocks.length === 0 || existingBlocks.length !== generatedBlocks.length) {
    throw new Error(
      'Managed Java layout changed; explicit code/model conflict resolution is required.',
    );
  }
  let blockIndex = 0;
  const merged = existing.replace(managedBlock, () => generatedBlocks[blockIndex++]?.[0] ?? '');
  return mergeImports(merged, generated);
}

/** Compares Java while ignoring formatter-only whitespace outside literals and comments. */
export function sameJavaTokens(left: string, right: string): boolean {
  if (left.includes('"""') || right.includes('"""')) return left === right;
  return normalizeJavaWhitespace(left) === normalizeJavaWhitespace(right);
}

/** Preserves the documented user supplement region while refreshing generated Markdown. */
export function mergeGeneratedDocument(existing: string | undefined, generated: string): string {
  if (existing === undefined) return generated;
  const previous = [...existing.matchAll(userSupplement)];
  const next = [...generated.matchAll(userSupplement)];
  if (previous.length === 0 || previous.length !== next.length) return generated;
  let index = 0;
  return generated.replace(userSupplement, () => previous[index++]?.[0] ?? '');
}

function mergeImports(existing: string, generated: string): string {
  const existingImports = [...existing.matchAll(importLine)].map((match) => match[0].trim());
  const generatedImports = [...generated.matchAll(importLine)].map((match) => match[0].trim());
  const imports = [...new Set([...existingImports, ...generatedImports])].sort((left, right) =>
    left.localeCompare(right),
  );
  if (imports.length === 0) return existing;
  const withoutImports = existing.replace(importLine, '').replace(/\n{3,}/gu, '\n\n');
  const packageEnd = withoutImports.indexOf(';');
  if (packageEnd < 0) throw new Error('Java source does not contain a package declaration.');
  return `${withoutImports.slice(0, packageEnd + 1)}\n\n${imports.join('\n')}\n${withoutImports.slice(packageEnd + 1).replace(/^\s*/u, '\n')}`;
}

function normalizeJavaWhitespace(source: string): string {
  const normalizedSource = source.replace(/\r\n?/gu, '\n');
  let result = '';
  let index = 0;
  let state: 'normal' | 'string' | 'character' | 'line-comment' | 'block-comment' = 'normal';
  while (index < normalizedSource.length) {
    const character = normalizedSource[index] ?? '';
    const next = normalizedSource[index + 1] ?? '';
    if (state === 'normal') {
      if (/\s/u.test(character)) {
        if (result.length > 0 && !result.endsWith(' ')) result += ' ';
        index += 1;
        continue;
      }
      if (character === '"') state = 'string';
      else if (character === "'") state = 'character';
      else if (character === '/' && next === '/') state = 'line-comment';
      else if (character === '/' && next === '*') state = 'block-comment';
      result += character;
      index += 1;
      continue;
    }
    result += character;
    if ((state === 'string' || state === 'character') && character === '\\') {
      result += next;
      index += 2;
      continue;
    }
    if (state === 'string' && character === '"') state = 'normal';
    else if (state === 'character' && character === "'") state = 'normal';
    else if (state === 'line-comment' && (character === '\n' || character === '\r'))
      state = 'normal';
    else if (state === 'block-comment' && character === '*' && next === '/') {
      result += next;
      index += 2;
      state = 'normal';
      continue;
    }
    index += 1;
  }
  return result.trim();
}
