import { describe, expect, it } from 'vitest';

import {
  classifyProjectFile,
  isIgnoredProjectPath,
  isWatchedProjectFile,
} from './project-files.js';

describe('FRC project file catalog', () => {
  it('recognizes Java, C++, Gradle, deploy, documentation, and team configuration files', () => {
    expect(classifyProjectFile('src/main/java/frc/robot/Robot.java')).toMatchObject({
      binary: false,
      format: 'Java',
      kind: 'java',
    });
    expect(classifyProjectFile('src/main/cpp/Robot.cpp')?.kind).toBe('cpp');
    expect(classifyProjectFile('build.gradle.kts')).toMatchObject({
      format: 'Gradle Kotlin build',
      kind: 'gradle',
    });
    expect(classifyProjectFile('src/main/deploy/pathplanner/paths/Center.path')?.kind).toBe(
      'pathplanner',
    );
    expect(classifyProjectFile('src/main/deploy/pathplanner/settings.json')?.kind).toBe(
      'pathplanner',
    );
    expect(classifyProjectFile('vendordeps/Phoenix6.json')?.format).toBe('FRC vendor dependency');
    expect(classifyProjectFile('docs/OPERATIONS.txt')?.kind).toBe('documentation');
    expect(classifyProjectFile('.wpilib/wpilib_preferences.json')?.kind).toBe('configuration');
    expect(classifyProjectFile('.clang-format')?.format).toBe('Clang format');
    expect(classifyProjectFile('tools/dashboard.ts')?.format).toBe('TypeScript');
    expect(classifyProjectFile('src/main/proto/vision.proto')?.format).toBe('Protocol Buffer');
    expect(classifyProjectFile('Dockerfile')?.kind).toBe('configuration');
  });

  it('supports common robot assets without treating binary files as text', () => {
    expect(classifyProjectFile('ascope_assets/robot.glb')).toMatchObject({
      binary: true,
      kind: 'asset',
    });
    expect(classifyProjectFile('src/main/deploy/field.svg')).toMatchObject({
      binary: false,
      kind: 'asset',
    });
    expect(classifyProjectFile('diagnostics.wpilog')).toMatchObject({
      binary: true,
      kind: 'log',
    });
  });

  it('ignores generated, dependency, repository, and log directories', () => {
    for (const candidate of [
      '.git/config',
      '.gradle/cache.properties',
      'build/generated/Robot.java',
      'bin/main/Robot.class',
      'node_modules/package/package.json',
      'logs/replay.wpilog',
    ]) {
      expect(isIgnoredProjectPath(candidate)).toBe(true);
      expect(isWatchedProjectFile(candidate)).toBe(false);
    }
    expect(classifyProjectFile('gradle/wrapper/gradle-wrapper.jar')).toBeUndefined();
  });
});
