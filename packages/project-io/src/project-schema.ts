export const PROJECT_SCHEMA = {
  $id: 'https://frc-framework.dev/schema/project-v1.json',
  $schema: 'http://json-schema.org/draft-07/schema#',
  additionalProperties: true,
  definitions: {
    entity: {
      additionalProperties: true,
      properties: {
        displayName: { minLength: 1, type: 'string' },
        id: { format: 'uuid', type: 'string' },
        notes: { type: 'string' },
        symbol: { pattern: '^[A-Za-z_$][A-Za-z\\d_$]*$', type: 'string' },
      },
      required: ['id', 'displayName', 'symbol'],
      type: 'object',
    },
    parameterValue: {
      anyOf: [
        { type: 'boolean' },
        { type: 'number' },
        { type: 'string' },
        { items: { type: 'number' }, type: 'array' },
        { items: { type: 'string' }, type: 'array' },
      ],
    },
    parameter: {
      additionalProperties: true,
      properties: {
        condition: {
          additionalProperties: true,
          properties: {
            baseVersion: { const: 1, type: 'integer' },
            equals: { $ref: '#/definitions/parameterValue' },
            parameter: { type: 'string' },
          },
          required: ['parameter', 'equals'],
          type: 'object',
        },
        defaultValue: { $ref: '#/definitions/parameterValue' },
        displayName: { minLength: 1, type: 'string' },
        enumValues: { items: { type: 'string' }, type: 'array' },
        id: { format: 'uuid', type: 'string' },
        key: { minLength: 1, type: 'string' },
        maximum: { type: 'number' },
        minimum: { type: 'number' },
        networkTables: {
          additionalProperties: true,
          properties: {
            enabled: { type: 'boolean' },
            path: { pattern: '^/', type: 'string' },
            tolerance: { minimum: 0, type: 'number' },
            writable: { type: 'boolean' },
          },
          required: ['enabled'],
          type: 'object',
        },
        source: {
          enum: ['default', 'preset', 'user', 'code', 'networktables'],
          type: 'string',
        },
        type: {
          enum: ['boolean', 'number', 'string', 'enum', 'number[]', 'string[]'],
          type: 'string',
        },
        unit: { type: 'string' },
        value: { $ref: '#/definitions/parameterValue' },
      },
      required: ['id', 'key', 'displayName', 'type', 'value', 'source'],
      type: 'object',
    },
  },
  properties: {
    autos: { items: { $ref: '#/definitions/entity' }, type: 'array' },
    bindings: {
      items: {
        additionalProperties: true,
        properties: {
          behavior: {
            enum: [
              'onTrue',
              'onFalse',
              'whileTrue',
              'whileFalse',
              'toggleOnTrue',
              'toggleOnFalse',
              'axis',
              'custom',
            ],
            type: 'string',
          },
          controllerId: { format: 'uuid', type: 'string' },
          id: { format: 'uuid', type: 'string' },
          input: { type: 'string' },
        },
        required: ['id', 'controllerId', 'input', 'behavior'],
        type: 'object',
      },
      type: 'array',
    },
    commands: { items: { $ref: '#/definitions/entity' }, type: 'array' },
    controllers: { items: { $ref: '#/definitions/entity' }, type: 'array' },
    devices: {
      items: {
        allOf: [
          { $ref: '#/definitions/entity' },
          {
            properties: {
              canId: { maximum: 62, minimum: 0, type: 'integer' },
              catalogId: { type: 'string' },
              kind: {
                enum: ['motor', 'encoder', 'gyro', 'sensor', 'pneumatic', 'camera', 'custom'],
                type: 'string',
              },
              model: { type: 'string' },
              networkTablesPath: { pattern: '^/', type: 'string' },
              role: { type: 'string' },
              parameters: { items: { $ref: '#/definitions/parameter' }, type: 'array' },
              parentId: { format: 'uuid', type: 'string' },
              vendor: { type: 'string' },
            },
            required: ['parentId', 'kind', 'vendor', 'model', 'parameters'],
          },
        ],
      },
      type: 'array',
    },
    docs: {
      items: {
        additionalProperties: true,
        properties: {
          generated: { type: 'boolean' },
          id: { format: 'uuid', type: 'string' },
          path: { type: 'string' },
          title: { type: 'string' },
        },
        required: ['id', 'title', 'path', 'generated'],
        type: 'object',
      },
      type: 'array',
    },
    networkTables: {
      additionalProperties: true,
      properties: {
        enabled: { type: 'boolean' },
        host: { type: 'string' },
        rootPath: { pattern: '^/', type: 'string' },
      },
      required: ['enabled', 'rootPath'],
      type: 'object',
    },
    project: {
      allOf: [
        { $ref: '#/definitions/entity' },
        {
          properties: {
            javaPackage: {
              pattern: '^(?:[a-z_$][a-z\\d_$]*)(?:\\.[a-z_$][a-z\\d_$]*)*$',
              type: 'string',
            },
            teamNumber: { minimum: 1, type: 'integer' },
            wpilibYear: { maximum: 2100, minimum: 2020, type: 'integer' },
          },
          required: ['baseVersion', 'teamNumber', 'javaPackage', 'wpilibYear'],
        },
      ],
    },
    presets: {
      items: {
        additionalProperties: true,
        properties: {
          customizedFiles: { items: { type: 'string' }, type: 'array' },
          displayName: { type: 'string' },
          id: { format: 'uuid', type: 'string' },
          parameters: {
            additionalProperties: { $ref: '#/definitions/parameterValue' },
            type: 'object',
          },
          presetId: { type: 'string' },
          version: { minimum: 1, type: 'integer' },
        },
        required: ['id', 'presetId', 'version', 'displayName', 'parameters', 'customizedFiles'],
        type: 'object',
      },
      type: 'array',
    },
    tuningHistory: {
      items: {
        additionalProperties: true,
        properties: {
          changes: { items: { type: 'object' }, type: 'array' },
          id: { format: 'uuid', type: 'string' },
          source: { const: 'networktables' },
          writtenAt: { type: 'string' },
        },
        required: ['id', 'writtenAt', 'source', 'changes'],
        type: 'object',
      },
      type: 'array',
    },
    tuningSnapshots: {
      items: {
        additionalProperties: true,
        properties: {
          capturedAt: { type: 'string' },
          id: { format: 'uuid', type: 'string' },
          name: { minLength: 1, type: 'string' },
          values: { type: 'object' },
        },
        required: ['id', 'name', 'capturedAt', 'values'],
        type: 'object',
      },
      type: 'array',
    },
    unmanagedFiles: {
      items: {
        minLength: 1,
        pattern: '^(?![\\\\/])(?!.*(?:^|[\\\\/])\\.\\.(?:[\\\\/]|$)).+$',
        type: 'string',
      },
      type: 'array',
    },
    robot: {
      allOf: [
        { $ref: '#/definitions/entity' },
        {
          properties: {
            containerClass: { type: 'string' },
            mainClass: { type: 'string' },
            mode: { const: 'command-based' },
            telemetry: {
              additionalProperties: false,
              properties: {
                fieldPublisher: { type: 'boolean' },
                stateRecorder: { type: 'boolean' },
              },
              required: ['fieldPublisher', 'stateRecorder'],
              type: 'object',
            },
          },
          required: ['mode', 'mainClass', 'containerClass'],
        },
      ],
    },
    schemaVersion: { const: 1, type: 'integer' },
    subsystems: {
      items: {
        allOf: [
          { $ref: '#/definitions/entity' },
          {
            properties: {
              behaviorMode: { enum: ['direct', 'goal-driven', 'custom'], type: 'string' },
              advantageKitLogging: { type: 'boolean' },
              generateGoalCommand: { type: 'boolean' },
              dependencies: {
                items: {
                  additionalProperties: false,
                  properties: {
                    fieldName: { pattern: '^[A-Za-z_$][A-Za-z\\d_$]*$', type: 'string' },
                    targetSubsystemId: { format: 'uuid', type: 'string' },
                  },
                  required: ['targetSubsystemId', 'fieldName'],
                  type: 'object',
                },
                type: 'array',
              },
              javaFile: { type: 'string' },
              javaPackage: { type: 'string' },
              kind: { enum: ['subsystem', 'mechanism', 'group'], type: 'string' },
              networkTablesPath: { pattern: '^/', type: 'string' },
              parentId: { format: 'uuid', type: 'string' },
              realImplementation: { type: 'boolean' },
              simulationImplementation: { type: 'boolean' },
            },
            required: ['kind'],
          },
        ],
      },
      type: 'array',
    },
  },
  required: [
    'schemaVersion',
    'project',
    'robot',
    'subsystems',
    'devices',
    'controllers',
    'bindings',
    'commands',
    'autos',
    'networkTables',
    'docs',
    'unmanagedFiles',
  ],
  title: 'FRC Framework Project',
  type: 'object',
} as const;
