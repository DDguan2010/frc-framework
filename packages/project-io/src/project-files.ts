import path from 'node:path';

export type ProjectFileKind =
  | 'java'
  | 'kotlin'
  | 'cpp'
  | 'gradle'
  | 'configuration'
  | 'documentation'
  | 'pathplanner'
  | 'script'
  | 'asset'
  | 'log'
  | 'text';

export interface ProjectFileDescriptor {
  readonly kind: ProjectFileKind;
  readonly format: string;
  readonly binary: boolean;
}

const ignoredDirectoryNames = new Set([
  '.frc-framework',
  '.git',
  '.gradle',
  '.idea',
  '.metadata',
  'bin',
  'build',
  'logs',
  'node_modules',
  'out',
  'target',
]);

const extensionDescriptors: Readonly<Record<string, ProjectFileDescriptor>> = {
  '.auto': descriptor('pathplanner', 'PathPlanner auto'),
  '.bat': descriptor('script', 'Windows batch'),
  '.c': descriptor('cpp', 'C'),
  '.cc': descriptor('cpp', 'C++'),
  '.cfg': descriptor('configuration', 'Configuration'),
  '.clang-format': descriptor('configuration', 'Clang format'),
  '.cmd': descriptor('script', 'Windows command script'),
  '.cpp': descriptor('cpp', 'C++'),
  '.csv': descriptor('text', 'CSV'),
  '.css': descriptor('text', 'CSS'),
  '.cxx': descriptor('cpp', 'C++'),
  '.glb': descriptor('asset', 'GLB model', true),
  '.h': descriptor('cpp', 'C/C++ header'),
  '.hpp': descriptor('cpp', 'C++ header'),
  '.hoot': descriptor('log', 'CTRE Hoot log', true),
  '.html': descriptor('documentation', 'HTML'),
  '.ico': descriptor('asset', 'Icon', true),
  '.ini': descriptor('configuration', 'INI'),
  '.java': descriptor('java', 'Java'),
  '.js': descriptor('script', 'JavaScript'),
  '.jpeg': descriptor('asset', 'JPEG image', true),
  '.jpg': descriptor('asset', 'JPEG image', true),
  '.json': descriptor('configuration', 'JSON'),
  '.json5': descriptor('configuration', 'JSON5'),
  '.jsx': descriptor('script', 'JavaScript JSX'),
  '.kt': descriptor('kotlin', 'Kotlin'),
  '.kts': descriptor('kotlin', 'Kotlin script'),
  '.md': descriptor('documentation', 'Markdown'),
  '.mtl': descriptor('asset', 'Wavefront material'),
  '.obj': descriptor('asset', 'OBJ model'),
  '.path': descriptor('pathplanner', 'PathPlanner path'),
  '.png': descriptor('asset', 'PNG image', true),
  '.properties': descriptor('configuration', 'Properties'),
  '.proto': descriptor('configuration', 'Protocol Buffer'),
  '.ps1': descriptor('script', 'PowerShell'),
  '.py': descriptor('script', 'Python'),
  '.sh': descriptor('script', 'Shell script'),
  '.scss': descriptor('text', 'SCSS'),
  '.stl': descriptor('asset', 'STL model', true),
  '.svg': descriptor('asset', 'SVG image'),
  '.toml': descriptor('configuration', 'TOML'),
  '.traj': descriptor('pathplanner', 'PathPlanner trajectory'),
  '.ts': descriptor('script', 'TypeScript'),
  '.tsv': descriptor('text', 'TSV'),
  '.tsx': descriptor('script', 'TypeScript JSX'),
  '.txt': descriptor('text', 'Text'),
  '.webp': descriptor('asset', 'WebP image', true),
  '.wpilog': descriptor('log', 'WPILib data log', true),
  '.xml': descriptor('configuration', 'XML'),
  '.yaml': descriptor('configuration', 'YAML'),
  '.yml': descriptor('configuration', 'YAML'),
};

const exactDescriptors: Readonly<Record<string, ProjectFileDescriptor>> = {
  '.clang-format': descriptor('configuration', 'Clang format'),
  '.editorconfig': descriptor('configuration', 'EditorConfig'),
  '.gitattributes': descriptor('configuration', 'Git attributes'),
  '.gitignore': descriptor('configuration', 'Git ignore'),
  Dockerfile: descriptor('configuration', 'Dockerfile'),
  LICENSE: descriptor('documentation', 'License'),
  Makefile: descriptor('configuration', 'Make'),
  'CMakeLists.txt': descriptor('configuration', 'CMake'),
  'build.gradle': descriptor('gradle', 'Gradle build'),
  'build.gradle.kts': descriptor('gradle', 'Gradle Kotlin build'),
  gradlew: descriptor('script', 'Gradle wrapper'),
  'gradlew.bat': descriptor('script', 'Gradle wrapper'),
  'networktables.json': descriptor('configuration', 'NetworkTables'),
  'settings.gradle': descriptor('gradle', 'Gradle settings'),
  'settings.gradle.kts': descriptor('gradle', 'Gradle Kotlin settings'),
};

export function classifyProjectFile(relativePath: string): ProjectFileDescriptor | undefined {
  const normalized = normalizeProjectPath(relativePath);
  if (isIgnoredProjectPath(normalized)) return undefined;
  const basename = path.posix.basename(normalized);
  const exact = exactDescriptors[basename];
  if (exact !== undefined) return exact;

  const extension = path.posix.extname(basename).toLowerCase();
  const base = extensionDescriptors[extension];
  if (base === undefined) return undefined;
  if (extension === '.gradle') return descriptor('gradle', 'Gradle');
  if (
    normalized.startsWith('src/main/deploy/pathplanner/') &&
    ['.json', '.json5'].includes(extension)
  ) {
    return descriptor('pathplanner', 'PathPlanner JSON');
  }
  if (normalized.startsWith('vendordeps/') && extension === '.json') {
    return descriptor('configuration', 'FRC vendor dependency');
  }
  if (normalized.startsWith('docs/') && base.kind === 'text') {
    return descriptor('documentation', base.format);
  }
  return base;
}

export function isIgnoredProjectPath(relativePath: string): boolean {
  return normalizeProjectPath(relativePath)
    .split('/')
    .some((segment) => ignoredDirectoryNames.has(segment));
}

export function isWatchedProjectFile(relativePath: string): boolean {
  return classifyProjectFile(relativePath) !== undefined;
}

export function normalizeProjectPath(relativePath: string): string {
  return relativePath.replace(/\\/gu, '/').replace(/^\.\/+/u, '');
}

function descriptor(kind: ProjectFileKind, format: string, binary = false): ProjectFileDescriptor {
  return { binary, format, kind };
}
