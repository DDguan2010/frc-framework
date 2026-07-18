export type NtConnectionState =
  'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'error';

export type NtType =
  | 'boolean'
  | 'double'
  | 'int'
  | 'float'
  | 'string'
  | 'json'
  | 'raw'
  | 'boolean[]'
  | 'double[]'
  | 'int[]'
  | 'float[]'
  | 'string[]';

export type NtValue =
  | boolean
  | number
  | string
  | Uint8Array
  | readonly boolean[]
  | readonly number[]
  | readonly string[];

export interface NtEndpoint {
  readonly host: string;
  readonly port?: number;
  readonly secure?: boolean;
  readonly clientName?: string;
}

export interface NtSubscriptionOptions {
  readonly prefix?: boolean;
  readonly periodicSeconds?: number;
  readonly allChanges?: boolean;
  readonly topicsOnly?: boolean;
}

export interface NtTopic {
  readonly id: number;
  readonly name: string;
  readonly type: NtType;
  readonly properties: Readonly<Record<string, unknown>>;
}

export interface NtValueUpdate {
  readonly topic: NtTopic;
  readonly timestampMicros: number;
  readonly value: NtValue;
}

export interface NtStatusEvent {
  readonly state: NtConnectionState;
  readonly detail?: string;
}

export type NtDiagnosticCode =
  | 'connection-error'
  | 'invalid-control-message'
  | 'invalid-value-message'
  | 'topic-type-changed'
  | 'topic-type-mismatch';

export interface NtDiagnostic {
  readonly code: NtDiagnosticCode;
  readonly message: string;
}

export interface NtClient {
  readonly state: NtConnectionState;
  connect(endpoint: NtEndpoint): void;
  disconnect(): void;
  subscribe(topics: readonly string[], options?: NtSubscriptionOptions): () => void;
  write(topic: string, type: NtType, value: NtValue): void;
  onStatus(listener: (event: NtStatusEvent) => void): () => void;
  onValue(listener: (event: NtValueUpdate) => void): () => void;
  onDiagnostic(listener: (event: NtDiagnostic) => void): () => void;
}
