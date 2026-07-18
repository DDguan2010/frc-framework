import type { EntityId, FrcProjectModel, Subsystem } from './model.js';

export interface SubsystemRemovalPlan {
  readonly model: FrcProjectModel;
  readonly removedAutoIds: readonly EntityId[];
  readonly removedBindingIds: readonly EntityId[];
  readonly removedCommandIds: readonly EntityId[];
  readonly removedDeviceIds: readonly EntityId[];
  readonly removedPresetIds: readonly EntityId[];
  readonly removedSubsystemIds: readonly EntityId[];
}

/** Removes one Goal/State and repairs the state-machine invariants. */
export function removeSubsystemState(subsystem: Subsystem, stateId: EntityId): Subsystem {
  const machine = subsystem.stateMachine;
  if (machine === undefined || !machine.states.some((state) => state.id === stateId)) {
    throw new Error(`State ${stateId} does not exist in subsystem ${subsystem.id}.`);
  }
  let states = machine.states.filter((state) => state.id !== stateId);
  if (states.length > 0 && !states.some((state) => state.initial === true)) {
    states = states.map((state, index) => (index === 0 ? { ...state, initial: true } : state));
  }
  return {
    ...subsystem,
    stateMachine: {
      ...machine,
      states,
      transitions: machine.transitions.filter(
        (transition) => transition.fromStateId !== stateId && transition.toStateId !== stateId,
      ),
    },
  };
}

/**
 * Removes a subsystem hierarchy and every structured entity that cannot remain
 * valid without it. Cross-subsystem dependencies and state actions are pruned;
 * commands, bindings, and autos owned by the removed hierarchy are cascaded.
 */
export function planSubsystemRemoval(
  model: FrcProjectModel,
  subsystemId: EntityId,
): SubsystemRemovalPlan {
  const selected = model.subsystems.find((subsystem) => subsystem.id === subsystemId);
  if (selected === undefined) throw new Error(`Subsystem ${subsystemId} does not exist.`);

  const removedSubsystemIds = new Set<EntityId>([subsystemId]);
  let addedSubsystem = true;
  while (addedSubsystem) {
    addedSubsystem = false;
    for (const subsystem of model.subsystems) {
      if (
        subsystem.parentId !== undefined &&
        removedSubsystemIds.has(subsystem.parentId) &&
        !removedSubsystemIds.has(subsystem.id)
      ) {
        removedSubsystemIds.add(subsystem.id);
        addedSubsystem = true;
      }
    }
  }

  const removedDeviceIds = new Set(
    model.devices
      .filter((device) => removedSubsystemIds.has(device.parentId))
      .map((device) => device.id),
  );
  // A follower or other structured device reference cannot survive its target.
  let addedDevice = true;
  while (addedDevice) {
    addedDevice = false;
    for (const device of model.devices) {
      if (removedDeviceIds.has(device.id)) continue;
      if (
        device.parameters.some((parameter) =>
          parameterReferencesAny(parameter.value, removedDeviceIds),
        )
      ) {
        removedDeviceIds.add(device.id);
        addedDevice = true;
      }
    }
  }

  const removedCommandIds = new Set(
    model.commands
      .filter((command) => command.requirementIds.some((id) => removedSubsystemIds.has(id)))
      .map((command) => command.id),
  );
  let addedCommand = true;
  while (addedCommand) {
    addedCommand = false;
    for (const command of model.commands) {
      if (removedCommandIds.has(command.id)) continue;
      if (command.childCommandIds?.some((id) => removedCommandIds.has(id)) === true) {
        removedCommandIds.add(command.id);
        addedCommand = true;
      }
    }
  }

  const removedBindingIds = new Set(
    model.bindings
      .filter(
        (binding) => binding.commandId !== undefined && removedCommandIds.has(binding.commandId),
      )
      .map((binding) => binding.id),
  );
  const removedAutoIds = new Set(
    model.autos
      .filter((auto) => auto.commandId !== undefined && removedCommandIds.has(auto.commandId))
      .map((auto) => auto.id),
  );
  const removedSubsystemNames = new Set(
    model.subsystems
      .filter((subsystem) => removedSubsystemIds.has(subsystem.id))
      .map((subsystem) => subsystem.displayName),
  );
  const removedPresetIds = new Set(
    model.presets
      .filter((preset) => {
        const rootSubsystemId = preset.parameters.rootSubsystemId;
        return (
          (typeof rootSubsystemId === 'string' && removedSubsystemIds.has(rootSubsystemId)) ||
          (rootSubsystemId === undefined && removedSubsystemNames.has(preset.displayName))
        );
      })
      .map((preset) => preset.id),
  );
  const removedTargets = new Set([...removedSubsystemIds, ...removedDeviceIds]);

  const subsystems = model.subsystems
    .filter((subsystem) => !removedSubsystemIds.has(subsystem.id))
    .map((subsystem) => ({
      ...subsystem,
      ...(subsystem.dependencies === undefined
        ? {}
        : {
            dependencies: subsystem.dependencies.filter(
              (dependency) => !removedSubsystemIds.has(dependency.targetSubsystemId),
            ),
          }),
      ...(subsystem.stateMachine === undefined
        ? {}
        : {
            stateMachine: {
              ...subsystem.stateMachine,
              states: subsystem.stateMachine.states.map((state) => ({
                ...state,
                actions: state.actions.filter(
                  (action) =>
                    !removedTargets.has(action.targetId) &&
                    (action.commandId === undefined || !removedCommandIds.has(action.commandId)),
                ),
              })),
            },
          }),
    }));

  return {
    model: {
      ...model,
      autos: model.autos.filter((auto) => !removedAutoIds.has(auto.id)),
      bindings: model.bindings.filter((binding) => !removedBindingIds.has(binding.id)),
      commands: model.commands.filter((command) => !removedCommandIds.has(command.id)),
      devices: model.devices.filter((device) => !removedDeviceIds.has(device.id)),
      presets: model.presets.filter((preset) => !removedPresetIds.has(preset.id)),
      subsystems,
    },
    removedAutoIds: [...removedAutoIds],
    removedBindingIds: [...removedBindingIds],
    removedCommandIds: [...removedCommandIds],
    removedDeviceIds: [...removedDeviceIds],
    removedPresetIds: [...removedPresetIds],
    removedSubsystemIds: [...removedSubsystemIds],
  };
}

function parameterReferencesAny(
  value: boolean | number | string | readonly number[] | readonly string[],
  ids: ReadonlySet<EntityId>,
): boolean {
  if (typeof value === 'string') return ids.has(value);
  return Array.isArray(value) && value.some((entry) => typeof entry === 'string' && ids.has(entry));
}
