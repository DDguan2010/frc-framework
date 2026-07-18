import { createRequire } from 'node:module';
import path from 'node:path';

import Parser from 'web-tree-sitter';

import type {
  CommandBinding,
  CommandMethod,
  ControllerDeclaration,
  JavaField,
  JavaImport,
  JavaMethod,
  JavaSourceIndex,
  JavaType,
  JavaTypeKind,
  ParseProblem,
  RecognizedPattern,
  SourceOwnership,
  SourceRange,
  StateDeclaration,
} from './types.js';

let parserRuntime: Promise<void> | undefined;
type SyntaxNode = Parser.SyntaxNode;

const typeKinds: Readonly<Record<string, JavaTypeKind>> = {
  annotation_type_declaration: 'annotation',
  class_declaration: 'class',
  enum_declaration: 'enum',
  interface_declaration: 'interface',
  record_declaration: 'record',
};

const controllerTypes = new Set([
  'CommandGenericHID',
  'CommandJoystick',
  'CommandPS4Controller',
  'CommandPS5Controller',
  'CommandXboxController',
  'GenericHID',
  'Joystick',
  'XboxController',
]);

const bindingEvents = new Set([
  'onFalse',
  'onTrue',
  'toggleOnFalse',
  'toggleOnTrue',
  'whileFalse',
  'whileTrue',
]);

const ironPulseSymbols = [
  'BeamBreak',
  'CANCoderIO',
  'IndicatorSubsystem',
  'LimelightSubsystem',
  'MotorIO',
  'MotorIOSim',
  'MotorIOTalonFX',
  'PositionMotorSubsystem',
  'SubsystemConfig',
  'Swerve',
  'VelocityMotorSubsystem',
] as const;

export interface JavaParserOptions {
  readonly javaWasmPath?: string;
  readonly runtimeWasmPath?: string;
}

export class JavaParserService {
  readonly #parser: Parser;

  private constructor(parser: Parser) {
    this.#parser = parser;
  }

  static async create(options: JavaParserOptions = {}): Promise<JavaParserService> {
    parserRuntime ??= Parser.init(
      options.runtimeWasmPath === undefined
        ? undefined
        : { locateFile: () => options.runtimeWasmPath as string },
    );
    await parserRuntime;

    const language = await Parser.Language.load(options.javaWasmPath ?? resolveJavaWasmPath());
    const parser = new Parser();
    parser.setLanguage(language);
    return new JavaParserService(parser);
  }

  index(source: string): JavaSourceIndex {
    const tree = this.#parser.parse(source);
    if (tree === null) {
      throw new Error('Tree-sitter did not return a Java syntax tree.');
    }

    try {
      const root = tree.rootNode;
      const imports = descendants(root, 'import_declaration').map(readImport);
      const types = descendantsWhere(root, (node) => node.type in typeKinds).map(readType);
      const allMethods = types.flatMap((type) => type.methods);
      const commandMethods = allMethods.flatMap(readCommandMethod);
      const controllers = types.flatMap((type) => type.fields).flatMap(readController);
      const bindings = descendants(root, 'method_invocation').flatMap(readBinding);
      const states = readStates(types);
      const patterns = recognizePatterns(source, bindings, controllers);
      const problems = descendantsWhereAll(
        root,
        (node) => node.type === 'ERROR' || node.isMissing(),
      ).map((node): ParseProblem => ({
        kind: node.isMissing() ? 'missing' : 'error',
        range: rangeOf(node),
      }));

      const packageNode = descendants(root, 'package_declaration')[0];
      const packageName = packageNode === undefined ? undefined : readPackageName(packageNode.text);
      const ownership = classifySource(source, root.hasError(), patterns);

      return {
        bindings,
        commandMethods,
        controllers,
        hasSyntaxErrors: root.hasError(),
        imports,
        ownership,
        ...(packageName === undefined ? {} : { packageName }),
        patterns,
        problems,
        states,
        types,
      };
    } finally {
      tree.delete();
    }
  }

  dispose(): void {
    this.#parser.delete();
  }
}

export function resolveJavaWasmPath(): string {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve('tree-sitter-wasms/package.json');
  return path.join(path.dirname(packageJson), 'out', 'tree-sitter-java.wasm');
}

function descendants(root: SyntaxNode, type: string): SyntaxNode[] {
  return descendantsWhere(root, (node) => node.type === type);
}

function descendantsWhere(
  root: SyntaxNode,
  predicate: (node: SyntaxNode) => boolean,
): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  const pending = [...root.namedChildren].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    if (predicate(node)) {
      found.push(node);
    }
    pending.push(...node.namedChildren.toReversed());
  }
  return found;
}

function descendantsWhereAll(
  root: SyntaxNode,
  predicate: (node: SyntaxNode) => boolean,
): SyntaxNode[] {
  const found: SyntaxNode[] = [];
  const pending = [...root.children].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) {
      continue;
    }
    if (predicate(node)) {
      found.push(node);
    }
    pending.push(...node.children.toReversed());
  }
  return found;
}

function readPackageName(text: string): string | undefined {
  return /^package\s+([\w.]+)\s*;/s.exec(text)?.[1];
}

function readImport(node: SyntaxNode): JavaImport {
  const match = /^import\s+(static\s+)?([\w.]+(?:\.\*)?)\s*;/s.exec(node.text);
  const name = match?.[2] ?? node.text.replace(/^import\s+|\s*;$/g, '');
  return {
    isStatic: match?.[1] !== undefined,
    name,
    range: rangeOf(node),
    wildcard: name.endsWith('.*'),
  };
}

function readType(node: SyntaxNode): JavaType {
  const name = node.childForFieldName('name')?.text ?? '<anonymous>';
  const body = node.childForFieldName('body');
  const fields = body?.namedChildren.filter((child) => child.type === 'field_declaration') ?? [];
  const methods =
    body?.namedChildren.filter((child) =>
      ['compact_constructor_declaration', 'constructor_declaration', 'method_declaration'].includes(
        child.type,
      ),
    ) ?? [];

  return {
    enumConstants:
      body?.namedChildren
        .filter((child) => child.type === 'enum_constant')
        .map((child) => child.childForFieldName('name')?.text ?? child.text.split('(')[0] ?? '')
        .filter(Boolean) ?? [],
    extendsTypes: readTypeList(node, ['extends_interfaces', 'superclass'], ['extends']),
    fields: fields.flatMap(readFields),
    implementsTypes: readTypeList(node, ['super_interfaces'], ['implements']),
    kind: typeKinds[node.type] ?? 'class',
    methods: methods.map(readMethod),
    modifiers: readModifiers(node),
    name,
    range: rangeOf(node),
  };
}

function readFields(node: SyntaxNode): JavaField[] {
  const type = node.childForFieldName('type')?.text ?? '<unknown>';
  const declarators = node.namedChildren.filter(
    (child) => child.type === 'variable_declarator' || child.type === 'constant_declaration',
  );
  const names =
    declarators.length > 0
      ? declarators.map((declarator) => declarator.childForFieldName('name')?.text ?? '<unknown>')
      : [node.childForFieldName('name')?.text ?? '<unknown>'];

  return names.map((name, index) => {
    const declarator = declarators[index];
    const initializer = declarator?.childForFieldName('value')?.text;
    return {
      ...(initializer === undefined ? {} : { initializer }),
      modifiers: readModifiers(node),
      name,
      range: rangeOf(node),
      type,
    };
  });
}

function readMethod(node: SyntaxNode): JavaMethod {
  const kind = node.type.includes('constructor') ? 'constructor' : 'method';
  const returnType = kind === 'method' ? node.childForFieldName('type')?.text : undefined;
  return {
    kind,
    modifiers: readModifiers(node),
    name: node.childForFieldName('name')?.text ?? '<anonymous>',
    parameters: node.childForFieldName('parameters')?.text ?? '()',
    range: rangeOf(node),
    ...(returnType === undefined ? {} : { returnType }),
  };
}

function readModifiers(node: SyntaxNode): string[] {
  const modifiers = node.namedChildren.find((child) => child.type === 'modifiers');
  return modifiers?.text.match(/[A-Za-z][A-Za-z0-9_]*/g) ?? [];
}

function readCommandMethod(method: JavaMethod): CommandMethod[] {
  if (method.kind !== 'method' || method.returnType === undefined) {
    return [];
  }
  if (!/(?:^|[<,.])\s*Command(?:\s*[>,.]|$)/.test(method.returnType)) {
    return [];
  }
  return [
    {
      name: method.name,
      parameters: method.parameters,
      range: method.range,
      returnType: method.returnType,
    },
  ];
}

function readController(field: JavaField): ControllerDeclaration[] {
  const simpleType = field.type.replace(/<.*>/s, '').split('.').at(-1) ?? field.type;
  if (!controllerTypes.has(simpleType)) {
    return [];
  }
  const portText =
    field.initializer === undefined
      ? undefined
      : /new\s+[\w$.]*\b(?:CommandGenericHID|CommandJoystick|CommandPS4Controller|CommandPS5Controller|CommandXboxController|GenericHID|Joystick|XboxController)\s*\(\s*(\d+)/u.exec(
          field.initializer,
        )?.[1];
  return [
    {
      controllerType: simpleType,
      fieldName: field.name,
      ...(portText === undefined ? {} : { port: Number(portText) }),
      range: field.range,
    },
  ];
}

function readBinding(node: SyntaxNode): CommandBinding[] {
  const methodName = node.childForFieldName('name')?.text;
  if (methodName === undefined || !bindingEvents.has(methodName)) {
    return [];
  }

  const object = node.childForFieldName('object')?.text ?? '<custom trigger>';
  const argumentsText = node.childForFieldName('arguments')?.text ?? '()';
  return [
    {
      commandExpression: argumentsText.slice(1, -1).trim(),
      event: methodName,
      range: rangeOf(node),
      triggerExpression: object,
    },
  ];
}

function readStates(types: readonly JavaType[]): StateDeclaration[] {
  return types
    .filter((type) => type.kind === 'enum')
    .map((type) => {
      const lowerName = type.name.toLowerCase();
      const role = lowerName.includes('goal')
        ? 'goal'
        : lowerName.includes('status')
          ? 'status'
          : lowerName.includes('state')
            ? 'state'
            : 'enum';
      return { name: type.name, range: type.range, role, values: type.enumConstants };
    });
}

function readTypeList(
  node: SyntaxNode,
  nodeTypes: readonly string[],
  keywords: readonly string[],
): readonly string[] {
  const relation = node.namedChildren.find((child) => nodeTypes.includes(child.type));
  if (relation === undefined) return [];
  let text = relation.text;
  for (const keyword of keywords) text = text.replace(new RegExp(`^${keyword}\\s+`, 'u'), '');
  return text
    .replace(/[{}]/gu, '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function recognizePatterns(
  source: string,
  bindings: readonly CommandBinding[],
  controllers: readonly ControllerDeclaration[],
): RecognizedPattern[] {
  const patterns: RecognizedPattern[] = [];
  for (const symbol of ironPulseSymbols) {
    const count = countWord(source, symbol);
    if (count > 0) {
      patterns.push({ confidence: 0.95, count, family: 'ironpulse', symbol });
    }
  }
  if (bindings.length > 0) {
    patterns.push({
      confidence: 0.9,
      count: bindings.length,
      family: 'wpilib-command',
      symbol: 'Trigger binding',
    });
  }
  if (controllers.length > 0) {
    patterns.push({
      confidence: 0.95,
      count: controllers.length,
      family: 'controller',
      symbol: 'HID declaration',
    });
  }
  const managedCount = (source.match(/<frc-framework:managed\b/g) ?? []).length;
  if (managedCount > 0) {
    patterns.push({
      confidence: 1,
      count: managedCount,
      family: 'managed-region',
      symbol: 'FRC Framework managed region',
    });
  }
  return patterns;
}

function countWord(source: string, word: string): number {
  return source.match(new RegExp(`\\b${word}\\b`, 'g'))?.length ?? 0;
}

function classifySource(
  source: string,
  hasSyntaxErrors: boolean,
  patterns: readonly RecognizedPattern[],
): SourceOwnership {
  if (source.includes('<frc-framework:managed')) {
    return {
      classification: 'managed',
      confidence: hasSyntaxErrors ? 0.75 : 1,
      reasons: hasSyntaxErrors
        ? ['Managed marker detected', 'Source currently contains syntax errors']
        : ['Managed marker detected'],
    };
  }

  if (patterns.length > 0 && !hasSyntaxErrors) {
    return {
      classification: 'recognized',
      confidence: Math.max(...patterns.map((pattern) => pattern.confidence)),
      reasons: patterns.map((pattern) => `${pattern.family}: ${pattern.symbol}`),
    };
  }

  return {
    classification: 'custom',
    confidence: hasSyntaxErrors ? 0.25 : patterns.length > 0 ? 0.6 : 1,
    reasons: [
      ...(hasSyntaxErrors ? ['Source currently contains syntax errors'] : []),
      ...(patterns.length > 0
        ? ['Some standard patterns were found, but the file requires custom handling']
        : ['No managed or safely recognized structure was found']),
    ],
  };
}

function rangeOf(node: SyntaxNode): SourceRange {
  return {
    end: { column: node.endPosition.column, row: node.endPosition.row },
    start: { column: node.startPosition.column, row: node.startPosition.row },
  };
}
