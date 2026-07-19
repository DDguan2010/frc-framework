/**
 * Replaces complete Java identifiers while leaving comments, character literals, strings, and
 * text blocks untouched. Structured snippets remain ordinary Java, so refactors must not rewrite
 * user-visible labels or commented examples that happen to contain an entity name.
 */
export function replaceJavaIdentifiers(
  source: string,
  replacements: ReadonlyMap<string, string>,
): string {
  if (replacements.size === 0 || source.length === 0) return source;
  let result = '';
  let index = 0;
  while (index < source.length) {
    const character = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (character === '/' && next === '/') {
      const end = source.indexOf('\n', index + 2);
      const stop = end < 0 ? source.length : end;
      result += source.slice(index, stop);
      index = stop;
      continue;
    }
    if (character === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2);
      const stop = end < 0 ? source.length : end + 2;
      result += source.slice(index, stop);
      index = stop;
      continue;
    }
    if (source.startsWith('"""', index)) {
      const end = source.indexOf('"""', index + 3);
      const stop = end < 0 ? source.length : end + 3;
      result += source.slice(index, stop);
      index = stop;
      continue;
    }
    if (character === '"' || character === "'") {
      const stop = quotedLiteralEnd(source, index, character);
      result += source.slice(index, stop);
      index = stop;
      continue;
    }
    if (isIdentifierStart(character)) {
      let stop = index + 1;
      while (stop < source.length && isIdentifierPart(source[stop] ?? '')) stop += 1;
      const identifier = source.slice(index, stop);
      result += replacements.get(identifier) ?? identifier;
      index = stop;
      continue;
    }
    result += character;
    index += 1;
  }
  return result;
}

function quotedLiteralEnd(source: string, start: number, quote: string): number {
  let escaped = false;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index] ?? '';
    if (!escaped && character === quote) return index + 1;
    if (!escaped && character === '\\') {
      escaped = true;
    } else {
      escaped = false;
    }
  }
  return source.length;
}

function isIdentifierStart(value: string): boolean {
  return /[A-Za-z_$]/u.test(value);
}

function isIdentifierPart(value: string): boolean {
  return /[A-Za-z0-9_$]/u.test(value);
}
