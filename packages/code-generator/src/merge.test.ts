import { describe, expect, it } from 'vitest';

import { mergeGeneratedDocument, mergeGeneratedJava } from './merge.js';

describe('generated content merge', () => {
  it('updates managed Java and imports without losing custom methods', () => {
    const existing = `package frc.robot;

import java.util.List;

public final class Example {
    // <frc-framework:managed>
    private int oldValue;
    // </frc-framework:managed>

    public int custom() { return 42; }
}
`;
    const generated = `package frc.robot;

import java.util.Map;

public final class Example {
    // <frc-framework:managed>
    private int newValue;
    // </frc-framework:managed>
}
`;
    const merged = mergeGeneratedJava(existing, generated);
    expect(merged).toContain('private int newValue;');
    expect(merged).not.toContain('oldValue');
    expect(merged).toContain('custom()');
    expect(merged).toContain('import java.util.List;');
    expect(merged).toContain('import java.util.Map;');
  });

  it('preserves user documentation supplements', () => {
    const existing = `Generated old\n<!-- frc-framework:user-supplement:start -->\nTeam note\n<!-- frc-framework:user-supplement:end -->\n`;
    const generated = `Generated new\n<!-- frc-framework:user-supplement:start -->\nPlaceholder\n<!-- frc-framework:user-supplement:end -->\n`;
    expect(mergeGeneratedDocument(existing, generated)).toContain('Generated new');
    expect(mergeGeneratedDocument(existing, generated)).toContain('Team note');
  });

  it('refuses to overwrite Java when managed boundaries no longer match', () => {
    expect(() =>
      mergeGeneratedJava(
        'package frc.robot;\nclass Custom {}\n',
        'package frc.robot;\nclass Generated {}\n',
      ),
    ).toThrow('conflict');
  });

  it('accepts an unchanged fully generated preset implementation without managed regions', () => {
    const generated = 'package frc.robot.subsystems.swerve;\nfinal class SwerveConfig {}\n';
    expect(mergeGeneratedJava(generated, generated)).toBe(generated);
  });

  it('still refuses to overwrite a modified fully generated preset implementation', () => {
    expect(() =>
      mergeGeneratedJava(
        'package frc.robot.subsystems.swerve;\nfinal class TeamEditedSwerveConfig {}\n',
        'package frc.robot.subsystems.swerve;\nfinal class SwerveConfig {}\n',
      ),
    ).toThrow('conflict');
  });
});
