export function isRendererReload(currentUrl: string, navigationUrl: string): boolean {
  if (currentUrl.length === 0 || navigationUrl.length === 0) return false;
  try {
    const current = new URL(currentUrl);
    const target = new URL(navigationUrl);
    if (current.protocol === 'file:' || current.protocol === 'data:') {
      return target.href === current.href;
    }
    return (
      target.origin === current.origin &&
      target.pathname === current.pathname &&
      target.search === current.search
    );
  } catch {
    return false;
  }
}

export function isAbortedNavigation(error: unknown): boolean {
  return (
    error instanceof Error &&
    ('code' in error ? error.code === 'ERR_ABORTED' : error.message.includes('ERR_ABORTED'))
  );
}
