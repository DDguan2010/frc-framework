export interface SourcePoint {
  readonly row: number;
  readonly column: number;
}

export interface SourceRange {
  readonly start: SourcePoint;
  readonly end: SourcePoint;
}

export type JavaTypeKind = 'class' | 'interface' | 'enum' | 'record' | 'annotation';

export interface JavaImport {
  readonly name: string;
  readonly isStatic: boolean;
  readonly wildcard: boolean;
  readonly range: SourceRange;
}

export interface JavaField {
  readonly name: string;
  readonly type: string;
  readonly modifiers: readonly string[];
  readonly range: SourceRange;
}

export interface JavaMethod {
  readonly name: string;
  readonly kind: 'method' | 'constructor';
  readonly returnType?: string;
  readonly parameters: string;
  readonly modifiers: readonly string[];
  readonly range: SourceRange;
}

export interface JavaType {
  readonly name: string;
  readonly kind: JavaTypeKind;
  readonly modifiers: readonly string[];
  readonly range: SourceRange;
  readonly fields: readonly JavaField[];
  readonly methods: readonly JavaMethod[];
}

export interface CommandMethod {
  readonly name: string;
  readonly parameters: string;
  readonly returnType: string;
  readonly range: SourceRange;
}

export interface ControllerDeclaration {
  readonly fieldName: string;
  readonly controllerType: string;
  readonly range: SourceRange;
}

export interface CommandBinding {
  readonly triggerExpression: string;
  readonly event: string;
  readonly commandExpression: string;
  readonly range: SourceRange;
}

export interface StateDeclaration {
  readonly name: string;
  readonly role: 'goal' | 'state' | 'status' | 'enum';
  readonly range: SourceRange;
}

export interface RecognizedPattern {
  readonly family: 'ironpulse' | 'wpilib-command' | 'controller' | 'managed-region';
  readonly symbol: string;
  readonly count: number;
  readonly confidence: number;
}

export type SourceClassification = 'managed' | 'recognized' | 'custom';

export interface SourceOwnership {
  readonly classification: SourceClassification;
  readonly confidence: number;
  readonly reasons: readonly string[];
}

export interface ParseProblem {
  readonly kind: 'error' | 'missing';
  readonly range: SourceRange;
}

export interface JavaSourceIndex {
  readonly packageName?: string;
  readonly imports: readonly JavaImport[];
  readonly types: readonly JavaType[];
  readonly commandMethods: readonly CommandMethod[];
  readonly controllers: readonly ControllerDeclaration[];
  readonly bindings: readonly CommandBinding[];
  readonly states: readonly StateDeclaration[];
  readonly patterns: readonly RecognizedPattern[];
  readonly ownership: SourceOwnership;
  readonly problems: readonly ParseProblem[];
  readonly hasSyntaxErrors: boolean;
}
