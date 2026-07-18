import type { Device, FrcProjectModel, ParameterValue } from '@frc-framework/domain';

export type HardwareProblemCode =
  | 'port-conflict'
  | 'invalid-symbol'
  | 'invalid-parameter'
  | 'follower-cycle'
  | 'missing-leader'
  | 'bus-mismatch'
  | 'nt-path-conflict'
  | 'missing-sim';

export interface HardwareProblem {
  readonly code: HardwareProblemCode;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly entityId: string;
  readonly field: string;
  readonly sourceFile?: string;
  readonly quickFix?: { readonly label: string; readonly value: ParameterValue };
}

export function validateHardware(model: FrcProjectModel): readonly HardwareProblem[] {
  return [
    ...validatePorts(model.devices),
    ...validateSymbols(model),
    ...validateParameters(model.devices),
    ...validateFollowers(model.devices),
    ...validateNtPaths(model),
    ...validateSimulation(model.devices),
  ];
}

function validatePorts(devices: readonly Device[]): HardwareProblem[] {
  const problems: HardwareProblem[] = [];
  const owners = new Map<string, Device>();
  for (const device of devices) {
    const port = portKey(device);
    if (port === undefined) continue;
    const previous = owners.get(port);
    if (previous === undefined) owners.set(port, device);
    else {
      problems.push(
        problem(
          'port-conflict',
          device,
          'canId',
          `${port} is already used by ${previous.displayName}.`,
        ),
      );
    }
  }
  return problems;
}

function portKey(device: Device): string | undefined {
  if (device.canId !== undefined) return `CAN:${device.canBus ?? 'rio'}:${String(device.canId)}`;
  const channel = parameterValue(device, 'channel');
  if (typeof channel !== 'number') return undefined;
  const declared = parameterValue(device, 'portType');
  const type =
    typeof declared === 'string' ? declared : device.model.includes('LED') ? 'pwm' : 'dio';
  return `${type.toUpperCase()}:${String(channel)}`;
}

function validateSymbols(model: FrcProjectModel): HardwareProblem[] {
  const problems: HardwareProblem[] = [];
  const owners = new Map<string, Device>();
  for (const device of model.devices) {
    if (!/^[A-Za-z_$][\w$]*$/u.test(device.symbol)) {
      problems.push(
        problem('invalid-symbol', device, 'symbol', `${device.symbol} is not a Java identifier.`),
      );
    }
    const scopedSymbol = `${device.parentId}:${device.symbol}`;
    const previous = owners.get(scopedSymbol);
    if (previous !== undefined) {
      problems.push(
        problem(
          'invalid-symbol',
          device,
          'symbol',
          `${device.symbol} is also used by ${previous.displayName}.`,
        ),
      );
    } else owners.set(scopedSymbol, device);
  }
  return problems;
}

function validateParameters(devices: readonly Device[]): HardwareProblem[] {
  const problems: HardwareProblem[] = [];
  for (const device of devices) {
    for (const parameter of device.parameters) {
      if (parameter.key === 'setpoints' && Array.isArray(parameter.value)) {
        const names = new Set<string>();
        for (const value of parameter.value) {
          const match =
            typeof value === 'string'
              ? /^\s*([A-Za-z_$][A-Za-z\d_$]*)\s*=\s*(-?(?:\d+(?:\.\d*)?|\.\d+))\s*$/u.exec(value)
              : null;
          if (match?.[1] === undefined) {
            problems.push(
              problem(
                'invalid-parameter',
                device,
                'parameters.setpoints',
                'Each setpoint must use NAME=value with a Java-safe unique name.',
              ),
            );
            break;
          }
          const normalized = match[1].toUpperCase();
          if (names.has(normalized)) {
            problems.push(
              problem(
                'invalid-parameter',
                device,
                'parameters.setpoints',
                `Setpoint ${match[1]} is defined more than once.`,
              ),
            );
            break;
          }
          names.add(normalized);
        }
      }
      if (typeof parameter.value !== 'number') continue;
      if (parameter.minimum !== undefined && parameter.value < parameter.minimum) {
        problems.push({
          ...problem(
            'invalid-parameter',
            device,
            `parameters.${parameter.key}`,
            `${parameter.displayName} is below ${String(parameter.minimum)}.`,
          ),
          quickFix: { label: `Use ${String(parameter.minimum)}`, value: parameter.minimum },
        });
      }
      if (parameter.maximum !== undefined && parameter.value > parameter.maximum) {
        problems.push({
          ...problem(
            'invalid-parameter',
            device,
            `parameters.${parameter.key}`,
            `${parameter.displayName} is above ${String(parameter.maximum)}.`,
          ),
          quickFix: { label: `Use ${String(parameter.maximum)}`, value: parameter.maximum },
        });
      }
    }
    const low = parameterValue(device, 'reverseSoftLimit');
    const high = parameterValue(device, 'forwardSoftLimit');
    if (typeof low === 'number' && typeof high === 'number' && low > high) {
      problems.push(
        problem(
          'invalid-parameter',
          device,
          'parameters.reverseSoftLimit',
          'Reverse soft limit must not exceed the forward limit.',
        ),
      );
    }
    const simLow = parameterValue(device, 'simMinimum');
    const simHigh = parameterValue(device, 'simMaximum');
    if (typeof simLow === 'number' && typeof simHigh === 'number' && simLow > simHigh) {
      problems.push(
        problem(
          'invalid-parameter',
          device,
          'parameters.simMinimum',
          'Simulation lower bound must not exceed the upper bound.',
        ),
      );
    }
  }
  return problems;
}

function validateFollowers(devices: readonly Device[]): HardwareProblem[] {
  const byId = new Map(devices.map((device) => [device.id, device]));
  const problems: HardwareProblem[] = [];
  for (const device of devices) {
    const leaderId = parameterValue(device, 'leaderId');
    if (typeof leaderId !== 'string' || leaderId.length === 0) continue;
    const leader = byId.get(leaderId);
    if (leader === undefined) {
      problems.push(
        problem('missing-leader', device, 'parameters.leaderId', 'Follower leader does not exist.'),
      );
      continue;
    }
    if ((device.canBus ?? 'rio') !== (leader.canBus ?? 'rio')) {
      problems.push(
        problem('bus-mismatch', device, 'canBus', 'Follower and leader must use the same CAN bus.'),
      );
    }
    const visited = new Set([device.id]);
    let cursor: Device | undefined = leader;
    while (cursor !== undefined) {
      if (visited.has(cursor.id)) {
        problems.push(
          problem(
            'follower-cycle',
            device,
            'parameters.leaderId',
            'Follower relationship contains a cycle.',
          ),
        );
        break;
      }
      visited.add(cursor.id);
      const next = parameterValue(cursor, 'leaderId');
      cursor = typeof next === 'string' ? byId.get(next) : undefined;
    }
  }
  return problems;
}

function validateNtPaths(model: FrcProjectModel): HardwareProblem[] {
  const owners = new Map<string, Device>();
  const problems: HardwareProblem[] = [];
  for (const device of model.devices) {
    for (const parameter of device.parameters) {
      if (parameter.networkTables?.enabled !== true) continue;
      const path = tuningPath(model, device, parameter.key, parameter.networkTables.path);
      const previous = owners.get(path);
      if (!/^\/(?:[^/]+\/?)+$/u.test(path)) {
        problems.push(
          problem(
            'nt-path-conflict',
            device,
            `parameters.${parameter.key}.networkTables.path`,
            `${path} is not a valid absolute NT path.`,
          ),
        );
      } else if (previous !== undefined) {
        problems.push(
          problem(
            'nt-path-conflict',
            device,
            `parameters.${parameter.key}.networkTables.path`,
            `${path} is already used by ${previous.displayName}.`,
          ),
        );
      } else owners.set(path, device);
    }
  }
  return problems;
}

function tuningPath(
  model: FrcProjectModel,
  device: Device,
  parameterKey: string,
  explicitPath: string | undefined,
): string {
  if (explicitPath !== undefined) return explicitPath;
  if (device.networkTablesPath !== undefined)
    return joinNtPath(device.networkTablesPath, parameterKey);
  const byId = new Map(model.subsystems.map((entry) => [entry.id, entry]));
  const reverse = [];
  let current = byId.get(device.parentId);
  const visited = new Set<string>();
  while (current !== undefined && !visited.has(current.id)) {
    reverse.push(current);
    visited.add(current.id);
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
  }
  const lineage = reverse.reverse();
  const override = [...lineage]
    .reverse()
    .find((entry) => entry.networkTablesPath !== undefined)?.networkTablesPath;
  return override === undefined
    ? joinNtPath(
        model.networkTables.rootPath,
        ...lineage.map((entry) => entry.displayName),
        device.displayName,
        parameterKey,
      )
    : joinNtPath(override, device.displayName, parameterKey);
}

function joinNtPath(...segments: readonly string[]): string {
  return normalizeNtPath(
    segments
      .map((entry) => entry.replace(/^\/+|\/+$/gu, ''))
      .filter(Boolean)
      .join('/'),
  );
}

function normalizeNtPath(value: string): string {
  return `/${value
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      const sanitized = segment
        .trim()
        .replace(/[^A-Za-z0-9_.-]+/gu, '_')
        .replace(/^_+|_+$/gu, '');
      return sanitized.length === 0 ? 'Unnamed' : sanitized;
    })
    .join('/')}`;
}

function validateSimulation(devices: readonly Device[]): HardwareProblem[] {
  return devices.flatMap((device) => {
    const realOnly = parameterValue(device, 'realOnly');
    const simFallback = parameterValue(device, 'simFallback');
    return realOnly === true && simFallback !== true
      ? [
          problem(
            'missing-sim',
            device,
            'parameters.simFallback',
            'Real device has no simulation fallback.',
            'warning',
          ),
        ]
      : [];
  });
}

function parameterValue(device: Device, key: string): ParameterValue | undefined {
  return device.parameters.find((parameter) => parameter.key === key)?.value;
}

function problem(
  code: HardwareProblemCode,
  device: Device,
  field: string,
  message: string,
  severity: HardwareProblem['severity'] = 'error',
): HardwareProblem {
  return {
    code,
    entityId: device.id,
    field,
    message,
    severity,
    ...(device.parentId.length === 0 ? {} : { sourceFile: device.parentId }),
  };
}
