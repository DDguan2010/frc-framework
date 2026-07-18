import {
  SUPPORTED_WPILIB_YEARS,
  type DeviceParameter,
  type EntityCollection,
  type EntityId,
  type FrcProjectModel,
  type ParameterValue,
} from './model.js';

export interface ModelProblem {
  readonly code: string;
  readonly message: string;
  readonly path: string;
  readonly entityId?: EntityId;
  readonly severity: 'error' | 'warning';
}

const javaIdentifier = /^[A-Za-z_$][A-Za-z\d_$]*$/u;
const javaPackage = /^(?:[a-z_$][a-z\d_$]*)(?:\.[a-z_$][a-z\d_$]*)*$/u;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function validateModel(model: FrcProjectModel): readonly ModelProblem[] {
  const problems: ModelProblem[] = [];
  if (model.schemaVersion !== 1) {
    problems.push(error('schema-version', '/schemaVersion', 'Only schemaVersion 1 is supported.'));
  }
  if (model.project.baseVersion !== 1) {
    problems.push(
      error('base-version', '/project/baseVersion', 'Only Base version 1 is supported.'),
    );
  }
  if (!(SUPPORTED_WPILIB_YEARS as readonly number[]).includes(model.project.wpilibYear)) {
    problems.push(
      error(
        'wpilib-year',
        '/project/wpilibYear',
        `WPILib ${String(model.project.wpilibYear)} is not supported by this release.`,
      ),
    );
  }
  if (!Number.isInteger(model.project.teamNumber) || model.project.teamNumber < 1) {
    problems.push(
      error('team-number', '/project/teamNumber', 'Team number must be a positive integer.'),
    );
  }
  if (!javaPackage.test(model.project.javaPackage)) {
    problems.push(error('java-package', '/project/javaPackage', 'Invalid lowercase Java package.'));
  }
  if (!model.networkTables.rootPath.startsWith('/')) {
    problems.push(
      error('nt-root-path', '/networkTables/rootPath', 'NT root path must be absolute.'),
    );
  }
  for (const [index, filePath] of model.unmanagedFiles.entries()) {
    if (
      filePath.length === 0 ||
      filePath.startsWith('/') ||
      filePath.startsWith('\\') ||
      filePath.split(/[\\/]/u).includes('..')
    ) {
      problems.push(
        error(
          'unsafe-unmanaged-path',
          `/unmanagedFiles/${String(index)}`,
          'Unmanaged file paths must stay inside the project.',
        ),
      );
    }
  }

  const ids = new Map<EntityId, string>();
  checkIdentity(model.project.id, '/project', ids, problems);
  checkIdentity(model.robot.id, '/robot', ids, problems);
  checkSymbol(model.project.symbol, '/project/symbol', model.project.id, problems);
  checkSymbol(model.robot.symbol, '/robot/symbol', model.robot.id, problems);

  const collections: readonly EntityCollection[] = [
    'subsystems',
    'devices',
    'controllers',
    'bindings',
    'commands',
    'autos',
    'docs',
  ];
  for (const collection of collections) {
    const entities = model[collection];
    entities.forEach((entity, index) => {
      const path = `/${collection}/${index}`;
      checkIdentity(entity.id, path, ids, problems);
      if ('symbol' in entity) {
        checkSymbol(entity.symbol, `${path}/symbol`, entity.id, problems);
      }
    });
  }
  for (const [index, preset] of model.presets.entries()) {
    checkIdentity(preset.id, `/presets/${index}`, ids, problems);
  }

  const subsystemIds = new Set(model.subsystems.map((entity) => entity.id));
  for (const [index, subsystem] of model.subsystems.entries()) {
    if (subsystem.parentId !== undefined && !subsystemIds.has(subsystem.parentId)) {
      problems.push(
        error(
          'missing-parent',
          `/subsystems/${index}/parentId`,
          'Subsystem parent does not exist.',
          subsystem.id,
        ),
      );
    }
    if (subsystem.parentId === subsystem.id) {
      problems.push(
        error(
          'parent-cycle',
          `/subsystems/${index}/parentId`,
          'Entity cannot parent itself.',
          subsystem.id,
        ),
      );
    }
    for (const [dependencyIndex, dependency] of (subsystem.dependencies ?? []).entries()) {
      if (!subsystemIds.has(dependency.targetSubsystemId)) {
        problems.push(
          error(
            'missing-dependency',
            `/subsystems/${index}/dependencies/${dependencyIndex}/targetSubsystemId`,
            'Subsystem dependency does not exist.',
            subsystem.id,
          ),
        );
      }
      if (dependency.targetSubsystemId === subsystem.id) {
        problems.push(
          error(
            'dependency-cycle',
            `/subsystems/${index}/dependencies/${dependencyIndex}/targetSubsystemId`,
            'Subsystem cannot depend on itself.',
            subsystem.id,
          ),
        );
      }
    }
  }
  for (const subsystem of model.subsystems) {
    if (hasDependencyCycle(subsystem.id, model.subsystems, new Set(), new Set())) {
      problems.push(
        error(
          'dependency-cycle',
          `/subsystems/${String(model.subsystems.indexOf(subsystem))}/dependencies`,
          'Subsystem dependency graph contains a cycle; coordinate through RobotCommands or a Superstructure.',
          subsystem.id,
        ),
      );
    }
  }

  const canAddresses = new Map<string, EntityId>();
  for (const [index, device] of model.devices.entries()) {
    if (!subsystemIds.has(device.parentId)) {
      problems.push(
        error(
          'missing-parent',
          `/devices/${index}/parentId`,
          'Device parent does not exist.',
          device.id,
        ),
      );
    }
    if (device.canId !== undefined) {
      if (!Number.isInteger(device.canId) || device.canId < 0 || device.canId > 62) {
        problems.push(
          error(
            'can-id-range',
            `/devices/${index}/canId`,
            'CAN ID must be between 0 and 62.',
            device.id,
          ),
        );
      }
      const address = `${device.canBus ?? 'rio'}:${String(device.canId)}`;
      const owner = canAddresses.get(address);
      if (owner !== undefined) {
        problems.push(
          error(
            'duplicate-can-id',
            `/devices/${index}/canId`,
            `CAN address ${address} is already used.`,
            device.id,
          ),
        );
      } else {
        canAddresses.set(address, device.id);
      }
    }
    device.parameters.forEach((parameter, parameterIndex) => {
      validateParameter(
        parameter,
        `/devices/${index}/parameters/${parameterIndex}`,
        device.id,
        problems,
      );
    });
    if (device.networkTablesPath !== undefined && !device.networkTablesPath.startsWith('/')) {
      problems.push(
        error(
          'nt-device-path',
          `/devices/${index}/networkTablesPath`,
          'Device NT path must be absolute.',
          device.id,
        ),
      );
    }
  }

  const controllerIds = new Set(model.controllers.map((entity) => entity.id));
  const commandIds = new Set(model.commands.map((entity) => entity.id));
  const usbPorts = new Map<number, EntityId>();
  for (const [index, controller] of model.controllers.entries()) {
    if (!Number.isInteger(controller.port) || controller.port < 0 || controller.port > 5) {
      problems.push(
        error(
          'usb-port-range',
          `/controllers/${index}/port`,
          'USB controller port must be between 0 and 5.',
          controller.id,
        ),
      );
    }
    const owner = usbPorts.get(controller.port);
    if (owner !== undefined) {
      problems.push(
        error(
          'duplicate-usb-port',
          `/controllers/${index}/port`,
          `USB port ${String(controller.port)} is already used.`,
          controller.id,
        ),
      );
    } else usbPorts.set(controller.port, controller.id);
  }
  const bindingsByInput = new Map<string, FrcProjectModel['bindings'][number]>();
  for (const [index, binding] of model.bindings.entries()) {
    if (!controllerIds.has(binding.controllerId)) {
      problems.push(
        error(
          'missing-controller',
          `/bindings/${index}/controllerId`,
          'Controller does not exist.',
          binding.id,
        ),
      );
    }
    if (binding.commandId !== undefined && !commandIds.has(binding.commandId)) {
      problems.push(
        error(
          'missing-command',
          `/bindings/${index}/commandId`,
          'Command does not exist.',
          binding.id,
        ),
      );
    }
    const inputKey = `${binding.controllerId}:${binding.input}`;
    const existing = bindingsByInput.get(inputKey);
    if (existing !== undefined && existing.id !== binding.id) {
      const first = model.commands.find((command) => command.id === existing.commandId);
      const second = model.commands.find((command) => command.id === binding.commandId);
      const overlapping = first?.requirementIds.some((id) => second?.requirementIds.includes(id));
      if (overlapping === true) {
        problems.push(
          warning(
            'binding-requirement-conflict',
            `/bindings/${index}`,
            'Commands on the same input may compete for the same subsystem requirement.',
            binding.id,
          ),
        );
      }
    } else bindingsByInput.set(inputKey, binding);
  }
  for (const [index, command] of model.commands.entries()) {
    command.requirementIds.forEach((id, requirementIndex) => {
      if (!subsystemIds.has(id)) {
        problems.push(
          error(
            'missing-requirement',
            `/commands/${index}/requirementIds/${requirementIndex}`,
            'Command requirement does not exist.',
            command.id,
          ),
        );
      }
    });
    command.childCommandIds?.forEach((id, childIndex) => {
      if (!commandIds.has(id)) {
        problems.push(
          error(
            'missing-child-command',
            `/commands/${index}/childCommandIds/${childIndex}`,
            'Child command does not exist.',
            command.id,
          ),
        );
      }
      if (id === command.id) {
        problems.push(
          error(
            'command-cycle',
            `/commands/${index}/childCommandIds/${childIndex}`,
            'A command cannot contain itself.',
            command.id,
          ),
        );
      }
    });
  }
  const namedCommands = new Set<string>();
  const compositionUseCount = new Map<EntityId, number>();
  for (const command of model.commands) {
    for (const childId of command.childCommandIds ?? []) {
      compositionUseCount.set(childId, (compositionUseCount.get(childId) ?? 0) + 1);
    }
  }
  for (const [index, command] of model.commands.entries()) {
    if (command.factory === false && (compositionUseCount.get(command.id) ?? 0) > 1) {
      problems.push(
        error(
          'reused-command-instance',
          `/commands/${index}/factory`,
          'A Command instance cannot be consumed by multiple compositions; use a factory method.',
          command.id,
        ),
      );
    }
    if (command.pathplannerName === undefined) continue;
    if (command.pathplannerName.trim().length === 0) {
      problems.push(
        error(
          'invalid-named-command',
          `/commands/${index}/pathplannerName`,
          'PathPlanner named command cannot be empty.',
          command.id,
        ),
      );
    } else if (namedCommands.has(command.pathplannerName)) {
      problems.push(
        error(
          'duplicate-named-command',
          `/commands/${index}/pathplannerName`,
          'PathPlanner named command must be unique.',
          command.id,
        ),
      );
    } else namedCommands.add(command.pathplannerName);
  }
  for (const [index, auto] of model.autos.entries()) {
    if (auto.commandId !== undefined && !commandIds.has(auto.commandId)) {
      problems.push(
        error(
          'missing-auto-command',
          `/autos/${index}/commandId`,
          'Autonomous routine command does not exist.',
          auto.id,
        ),
      );
    }
    for (const [pathIndex, pathFile] of auto.pathFiles.entries()) {
      if (
        pathFile.trim().length === 0 ||
        pathFile.startsWith('/') ||
        pathFile.startsWith('\\') ||
        pathFile.includes('..')
      ) {
        problems.push(
          error(
            'invalid-auto-path',
            `/autos/${index}/pathFiles/${pathIndex}`,
            'Auto path must be a project-relative deploy path without parent traversal.',
            auto.id,
          ),
        );
      }
    }
  }
  return problems;
}

function hasDependencyCycle(
  id: EntityId,
  subsystems: FrcProjectModel['subsystems'],
  visiting: Set<EntityId>,
  complete: Set<EntityId>,
): boolean {
  if (complete.has(id)) return false;
  if (visiting.has(id)) return true;
  visiting.add(id);
  const subsystem = subsystems.find((entry) => entry.id === id);
  for (const dependency of subsystem?.dependencies ?? []) {
    if (hasDependencyCycle(dependency.targetSubsystemId, subsystems, visiting, complete))
      return true;
  }
  visiting.delete(id);
  complete.add(id);
  return false;
}

export function isJavaIdentifier(value: string): boolean {
  return javaIdentifier.test(value);
}

export function isJavaPackage(value: string): boolean {
  return javaPackage.test(value);
}

function validateParameter(
  parameter: DeviceParameter,
  path: string,
  entityId: EntityId,
  problems: ModelProblem[],
): void {
  if (!parameterValueMatches(parameter.type, parameter.value)) {
    problems.push(
      error('parameter-type', `${path}/value`, `Value does not match ${parameter.type}.`, entityId),
    );
  }
  if (typeof parameter.value === 'number') {
    if (parameter.minimum !== undefined && parameter.value < parameter.minimum) {
      problems.push(
        error(
          'parameter-minimum',
          `${path}/value`,
          `Value is below ${parameter.minimum}.`,
          entityId,
        ),
      );
    }
    if (parameter.maximum !== undefined && parameter.value > parameter.maximum) {
      problems.push(
        error(
          'parameter-maximum',
          `${path}/value`,
          `Value is above ${parameter.maximum}.`,
          entityId,
        ),
      );
    }
  }
  if (
    parameter.type === 'enum' &&
    typeof parameter.value === 'string' &&
    parameter.enumValues?.includes(parameter.value) !== true
  ) {
    problems.push(
      error('parameter-enum', `${path}/value`, 'Value is not an allowed option.', entityId),
    );
  }
  if (
    parameter.networkTables?.tolerance !== undefined &&
    (!Number.isFinite(parameter.networkTables.tolerance) || parameter.networkTables.tolerance < 0)
  ) {
    problems.push(
      error(
        'nt-tolerance',
        `${path}/networkTables/tolerance`,
        'NT tolerance must be a non-negative number.',
        entityId,
      ),
    );
  }
  if (
    parameter.networkTables?.path !== undefined &&
    !parameter.networkTables.path.startsWith('/')
  ) {
    problems.push(
      error('nt-path', `${path}/networkTables/path`, 'NT path must be absolute.', entityId),
    );
  }
}

function parameterValueMatches(type: DeviceParameter['type'], value: ParameterValue): boolean {
  switch (type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
    case 'enum':
      return typeof value === 'string';
    case 'number[]':
      return Array.isArray(value) && value.every((item) => typeof item === 'number');
    case 'string[]':
      return Array.isArray(value) && value.every((item) => typeof item === 'string');
  }
}

function checkIdentity(
  id: EntityId,
  path: string,
  ids: Map<EntityId, string>,
  problems: ModelProblem[],
): void {
  if (!uuid.test(id)) {
    problems.push(error('entity-id', `${path}/id`, 'Entity ID must be a UUID.', id));
  }
  const existing = ids.get(id);
  if (existing !== undefined) {
    problems.push(
      error('duplicate-entity-id', `${path}/id`, `Entity ID is also used at ${existing}.`, id),
    );
  } else {
    ids.set(id, path);
  }
}

function checkSymbol(
  symbol: string,
  path: string,
  entityId: EntityId,
  problems: ModelProblem[],
): void {
  if (!javaIdentifier.test(symbol)) {
    problems.push(error('java-symbol', path, 'Invalid Java identifier.', entityId));
  }
}

function error(code: string, path: string, message: string, entityId?: EntityId): ModelProblem {
  return {
    code,
    message,
    path,
    severity: 'error',
    ...(entityId === undefined ? {} : { entityId }),
  };
}

function warning(code: string, path: string, message: string, entityId?: EntityId): ModelProblem {
  return {
    code,
    message,
    path,
    severity: 'warning',
    ...(entityId === undefined ? {} : { entityId }),
  };
}
