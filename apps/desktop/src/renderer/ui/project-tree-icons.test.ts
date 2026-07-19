import { describe, expect, it } from 'vitest';

import { PROJECT_TREE_ICONS, projectTreeIcon } from './project-tree-icons.js';

describe('structured project tree icons', () => {
  it('assigns every supported entity kind a unique Material icon', () => {
    const icons = Object.values(PROJECT_TREE_ICONS);

    expect(Object.keys(PROJECT_TREE_ICONS)).toHaveLength(13);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('visually separates motors and commands', () => {
    expect(projectTreeIcon('motor')).toBe('electric_bolt');
    expect(projectTreeIcon('command')).toBe('play_arrow');
    expect(projectTreeIcon('command')).not.toBe(projectTreeIcon('motor'));
  });
});
