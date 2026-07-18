export type ThreeWayResolution =
  'unchanged' | 'generated-update' | 'user-preserved' | 'same-change' | 'conflict';

export interface ThreeWayFileResult {
  readonly path: string;
  readonly resolution: ThreeWayResolution;
  readonly base?: string;
  readonly old?: string;
  readonly next?: string;
  readonly merged?: string;
}

export interface ThreeWayDiffResult {
  readonly files: readonly ThreeWayFileResult[];
  readonly merged: ReadonlyMap<string, string | null>;
  readonly conflicts: readonly ThreeWayFileResult[];
  readonly safeToApply: boolean;
}

/**
 * Compares the installed preset base, the user's current (old) files, and the new preset output.
 * Conflicting paths intentionally have no merged value and must be resolved before a transaction.
 */
export function createThreeWayDiff(
  base: ReadonlyMap<string, string>,
  old: ReadonlyMap<string, string>,
  next: ReadonlyMap<string, string>,
): ThreeWayDiffResult {
  const paths = [...new Set([...base.keys(), ...old.keys(), ...next.keys()])].sort();
  const files: ThreeWayFileResult[] = [];
  const merged = new Map<string, string | null>();
  for (const filePath of paths) {
    const baseValue = base.get(filePath);
    const oldValue = old.get(filePath);
    const nextValue = next.get(filePath);
    const result = resolveFile(filePath, baseValue, oldValue, nextValue);
    files.push(result);
    if (result.resolution !== 'conflict') merged.set(filePath, result.merged ?? null);
  }
  const conflicts = files.filter((file) => file.resolution === 'conflict');
  return { conflicts, files, merged, safeToApply: conflicts.length === 0 };
}

function resolveFile(
  filePath: string,
  base: string | undefined,
  old: string | undefined,
  next: string | undefined,
): ThreeWayFileResult {
  const values = {
    ...(base === undefined ? {} : { base }),
    ...(old === undefined ? {} : { old }),
    ...(next === undefined ? {} : { next }),
    path: filePath,
  };
  if (base === undefined && old === next)
    return { ...values, ...(old === undefined ? {} : { merged: old }), resolution: 'same-change' };
  if (old === next)
    return {
      ...values,
      ...(old === undefined ? {} : { merged: old }),
      resolution: 'unchanged',
    };
  if (old === base)
    return {
      ...values,
      ...(next === undefined ? {} : { merged: next }),
      resolution: 'generated-update',
    };
  if (next === base)
    return {
      ...values,
      ...(old === undefined ? {} : { merged: old }),
      resolution: 'user-preserved',
    };
  return { ...values, resolution: 'conflict' };
}
