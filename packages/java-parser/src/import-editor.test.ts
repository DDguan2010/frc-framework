import { describe, expect, it } from 'vitest';

import { addJavaImport, UnsafeImportEditError } from './import-editor.js';

describe('addJavaImport', () => {
  it('inserts, deduplicates, and sorts normal and static imports', () => {
    const source = `package frc.robot;\n\nimport java.util.List;\n\npublic class Robot {}\n`;
    const withNormal = addJavaImport(source, 'edu.wpi.first.wpilibj2.command.Command');
    const withStatic = addJavaImport(withNormal.source, 'edu.wpi.first.units.Units.Meters', {
      isStatic: true,
    });
    const duplicate = addJavaImport(withStatic.source, 'java.util.List');

    expect(withStatic.source).toContain(
      'import edu.wpi.first.wpilibj2.command.Command;\nimport java.util.List;\n\nimport static edu.wpi.first.units.Units.Meters;',
    );
    expect(duplicate.changed).toBe(false);
    expect(duplicate.source).toBe(withStatic.source);
  });

  it('preserves CRLF line endings', () => {
    const result = addJavaImport('package frc.robot;\r\n\r\nclass Robot {}\r\n', 'java.util.List');
    expect(result.source).toContain('package frc.robot;\r\n\r\nimport java.util.List;');
    expect(result.source.replaceAll('\r\n', '')).not.toContain('\n');
  });

  it('refuses to reorder an import block containing custom comments', () => {
    const source = `package frc.robot;\n\nimport java.util.List;\n// Keep this group.\nimport java.util.Map;\n`;
    expect(() => addJavaImport(source, 'java.util.Set')).toThrow(UnsafeImportEditError);
  });

  it('rejects an invalid import instead of emitting malformed Java', () => {
    expect(() => addJavaImport('class Robot {}', 'java.util.List; rm -rf')).toThrow(TypeError);
  });
});
