import { describe, expect, it } from 'vitest';

import { detectEditors, openEditor, validateEditor } from './editor-service.js';

describe('editor integration', () => {
  it('detects installed editors with array argument templates', async () => {
    const editors = await detectEditors();
    for (const editor of editors) {
      expect(editor.executable.length).toBeGreaterThan(0);
      expect(Array.isArray(editor.arguments)).toBe(true);
    }
  });

  it('validates placeholders and launches with shell disabled', async () => {
    await expect(
      validateEditor({
        arguments: ['--goto', '{file}:{line}:{column}', '{project}'],
        executable: process.execPath,
        id: 'test',
        name: 'Test',
      }),
    ).resolves.toBeUndefined();
    await expect(
      validateEditor({
        arguments: ['{unsupported}'],
        executable: process.execPath,
        id: 'test',
        name: 'Test',
      }),
    ).rejects.toThrow('Unsupported editor placeholder');

    const pid = await openEditor(
      {
        arguments: ['-e', 'process.exit(0)'],
        executable: process.execPath,
        id: 'node-test',
        name: 'Node test',
      },
      { file: process.execPath, project: process.cwd() },
    );
    expect(pid).toBeTypeOf('number');
  });
});
