import type { Device, Subsystem } from '@frc-framework/domain';

export type ProjectTreeEntityKind =
  'robot' | Subsystem['kind'] | Device['kind'] | 'goal' | 'command';

/**
 * Material Symbols used by the structured project tree. Each entity kind intentionally has a
 * unique glyph so nearby nodes can be distinguished without reading their badges.
 */
export const PROJECT_TREE_ICONS = {
  robot: 'smart_toy',
  subsystem: 'account_tree',
  group: 'folder_special',
  mechanism: 'precision_manufacturing',
  motor: 'electric_bolt',
  encoder: 'speed',
  gyro: 'explore',
  sensor: 'sensors',
  pneumatic: 'air',
  camera: 'videocam',
  custom: 'extension',
  goal: 'flag',
  command: 'play_arrow',
} as const satisfies Record<ProjectTreeEntityKind, string>;

export function projectTreeIcon(kind: ProjectTreeEntityKind): string {
  return PROJECT_TREE_ICONS[kind];
}
