import { planSubsystemRemoval } from './deletion.js';
import type { CollectionEntity, EntityCollection, EntityId, FrcProjectModel } from './model.js';

export type DomainCommand =
  | AddEntityCommand
  | RemoveEntityCommand
  | MoveEntityCommand
  | RenameEntityCommand
  | UpdateEntityCommand
  | BatchCommand;

export interface AddEntityCommand {
  readonly type: 'add';
  readonly collection: EntityCollection;
  readonly entity: CollectionEntity;
  readonly index?: number;
}

export interface RemoveEntityCommand {
  readonly type: 'remove';
  readonly collection: EntityCollection;
  readonly id: EntityId;
}

export interface MoveEntityCommand {
  readonly type: 'move';
  readonly collection: EntityCollection;
  readonly id: EntityId;
  readonly toIndex: number;
}

export interface RenameEntityCommand {
  readonly type: 'rename';
  readonly collection: EntityCollection;
  readonly id: EntityId;
  readonly displayName?: string;
  readonly symbol?: string;
}

export interface UpdateEntityCommand {
  readonly type: 'update';
  readonly target:
    | { readonly scope: 'project' | 'robot' | 'networkTables' | 'model' }
    | { readonly scope: 'entity'; readonly collection: EntityCollection; readonly id: EntityId };
  readonly changes: Readonly<Record<string, unknown>>;
}

export interface BatchCommand {
  readonly type: 'batch';
  readonly label: string;
  readonly commands: readonly DomainCommand[];
}

export interface CommandResult {
  readonly model: FrcProjectModel;
  readonly inverse: DomainCommand;
  readonly touchedEntityIds: readonly EntityId[];
  readonly outputFiles: readonly string[];
}

export function executeCommand(model: FrcProjectModel, command: DomainCommand): CommandResult {
  switch (command.type) {
    case 'add':
      return addEntity(model, command);
    case 'remove':
      return removeEntity(model, command);
    case 'move':
      return moveEntity(model, command);
    case 'rename':
      return renameEntity(model, command);
    case 'update':
      return updateEntity(model, command);
    case 'batch':
      return executeBatch(model, command);
  }
}

function addEntity(model: FrcProjectModel, command: AddEntityCommand): CommandResult {
  const collection = mutableCollection(model, command.collection);
  if (collection.some((entity) => entity.id === command.entity.id)) {
    throw new Error(`Entity ${command.entity.id} already exists in ${command.collection}.`);
  }
  const index = Math.max(0, Math.min(command.index ?? collection.length, collection.length));
  collection.splice(index, 0, structuredClone(command.entity));
  return result(
    withCollection(model, command.collection, collection),
    { collection: command.collection, id: command.entity.id, type: 'remove' },
    [command.entity.id],
    command.collection,
  );
}

function removeEntity(model: FrcProjectModel, command: RemoveEntityCommand): CommandResult {
  if (command.collection === 'subsystems') {
    const plan = planSubsystemRemoval(model, command.id);
    return {
      inverse: {
        changes: {
          autos: model.autos,
          bindings: model.bindings,
          commands: model.commands,
          devices: model.devices,
          presets: model.presets,
          subsystems: model.subsystems,
        },
        target: { scope: 'model' },
        type: 'update',
      },
      model: plan.model,
      outputFiles: [
        'project.yaml',
        'src/main/java/{package}/RobotContainer.java',
        'src/main/java/{package}/commands/**',
        'src/main/java/{package}/subsystems/**',
        'docs/**',
      ],
      touchedEntityIds: [
        ...plan.removedSubsystemIds,
        ...plan.removedDeviceIds,
        ...plan.removedCommandIds,
        ...plan.removedBindingIds,
        ...plan.removedAutoIds,
        ...plan.removedPresetIds,
      ],
    };
  }
  const collection = mutableCollection(model, command.collection);
  const index = collection.findIndex((entity) => entity.id === command.id);
  if (index < 0) {
    throw new Error(`Entity ${command.id} does not exist in ${command.collection}.`);
  }
  const [removed] = collection.splice(index, 1);
  if (removed === undefined) {
    throw new Error('Failed to remove entity.');
  }
  return result(
    withCollection(model, command.collection, collection),
    { collection: command.collection, entity: removed, index, type: 'add' },
    [command.id],
    command.collection,
  );
}

function moveEntity(model: FrcProjectModel, command: MoveEntityCommand): CommandResult {
  const collection = mutableCollection(model, command.collection);
  const fromIndex = collection.findIndex((entity) => entity.id === command.id);
  if (fromIndex < 0) {
    throw new Error(`Entity ${command.id} does not exist in ${command.collection}.`);
  }
  const target = Math.max(0, Math.min(command.toIndex, collection.length - 1));
  const [entity] = collection.splice(fromIndex, 1);
  if (entity === undefined) {
    throw new Error('Failed to move entity.');
  }
  collection.splice(target, 0, entity);
  return result(
    withCollection(model, command.collection, collection),
    { collection: command.collection, id: command.id, toIndex: fromIndex, type: 'move' },
    [command.id],
    command.collection,
  );
}

function renameEntity(model: FrcProjectModel, command: RenameEntityCommand): CommandResult {
  const collection = mutableCollection(model, command.collection);
  const index = collection.findIndex((entity) => entity.id === command.id);
  const entity = collection[index];
  if (entity === undefined || !('displayName' in entity) || !('symbol' in entity)) {
    throw new Error(`Entity ${command.id} cannot be renamed.`);
  }
  const previous: RenameEntityCommand = {
    collection: command.collection,
    displayName: entity.displayName,
    id: command.id,
    symbol: entity.symbol,
    type: 'rename',
  };
  collection[index] = {
    ...entity,
    ...(command.displayName === undefined ? {} : { displayName: command.displayName }),
    ...(command.symbol === undefined ? {} : { symbol: command.symbol }),
  };
  return result(
    withCollection(model, command.collection, collection),
    previous,
    [command.id],
    command.collection,
  );
}

function updateEntity(model: FrcProjectModel, command: UpdateEntityCommand): CommandResult {
  if (command.target.scope !== 'entity') {
    if (command.target.scope === 'model') {
      const previous = pickValues(model, Object.keys(command.changes));
      return {
        inverse: { changes: previous, target: command.target, type: 'update' },
        model: { ...model, ...structuredClone(command.changes) },
        outputFiles: ['project.yaml', 'docs/ROBOT.md'],
        touchedEntityIds: [],
      };
    }
    const key = command.target.scope;
    const current = model[key];
    const previous = pickValues(current, Object.keys(command.changes));
    return {
      inverse: { changes: previous, target: command.target, type: 'update' },
      model: { ...model, [key]: { ...current, ...structuredClone(command.changes) } },
      outputFiles: outputFilesForScope(key),
      touchedEntityIds: 'id' in current ? [current.id] : [],
    };
  }
  const target = command.target;
  const collection = mutableCollection(model, target.collection);
  const index = collection.findIndex((entity) => entity.id === target.id);
  const entity = collection[index];
  if (entity === undefined) {
    throw new Error(`Entity ${target.id} does not exist.`);
  }
  const previous = pickValues(entity, Object.keys(command.changes));
  collection[index] = { ...entity, ...structuredClone(command.changes) };
  return result(
    withCollection(model, target.collection, collection),
    { changes: previous, target, type: 'update' },
    [target.id],
    target.collection,
  );
}

function executeBatch(model: FrcProjectModel, command: BatchCommand): CommandResult {
  let current = model;
  const inverses: DomainCommand[] = [];
  const touched = new Set<EntityId>();
  const files = new Set<string>();
  for (const child of command.commands) {
    const childResult = executeCommand(current, child);
    current = childResult.model;
    inverses.unshift(childResult.inverse);
    childResult.touchedEntityIds.forEach((id) => touched.add(id));
    childResult.outputFiles.forEach((file) => files.add(file));
  }
  return {
    inverse: { commands: inverses, label: `Undo ${command.label}`, type: 'batch' },
    model: current,
    outputFiles: [...files].sort(),
    touchedEntityIds: [...touched],
  };
}

function mutableCollection(
  model: FrcProjectModel,
  collection: EntityCollection,
): CollectionEntity[] {
  return structuredClone(model[collection]) as CollectionEntity[];
}

function withCollection(
  model: FrcProjectModel,
  collection: EntityCollection,
  entities: readonly CollectionEntity[],
): FrcProjectModel {
  return { ...model, [collection]: entities } as FrcProjectModel;
}

function result(
  model: FrcProjectModel,
  inverse: DomainCommand,
  touchedEntityIds: readonly EntityId[],
  collection: EntityCollection,
): CommandResult {
  return {
    inverse,
    model,
    outputFiles: outputFilesForCollection(collection),
    touchedEntityIds,
  };
}

function outputFilesForScope(scope: 'project' | 'robot' | 'networkTables'): readonly string[] {
  if (scope === 'project') {
    return ['project.yaml', 'build.gradle', 'settings.gradle'];
  }
  if (scope === 'robot') {
    return [
      'project.yaml',
      'src/main/java/{package}/Robot.java',
      'src/main/java/{package}/RobotContainer.java',
    ];
  }
  return ['project.yaml', 'src/main/java/{package}/Telemetry.java'];
}

function outputFilesForCollection(collection: EntityCollection): readonly string[] {
  switch (collection) {
    case 'subsystems':
    case 'devices':
      return ['project.yaml', 'src/main/java/{package}/subsystems/**'];
    case 'controllers':
    case 'bindings':
      return ['project.yaml', 'src/main/java/{package}/controls/OperatorInterface.java'];
    case 'commands':
      return ['project.yaml', 'src/main/java/{package}/commands/**'];
    case 'autos':
      return ['project.yaml', 'src/main/java/{package}/auto/**'];
    case 'docs':
      return ['project.yaml', 'docs/**'];
  }
}

function pickValues(source: object, keys: readonly string[]): Record<string, unknown> {
  const record = source as unknown as Record<string, unknown>;
  return Object.fromEntries(keys.map((key) => [key, structuredClone(record[key])]));
}
