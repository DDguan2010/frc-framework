import { decodeMulti, encode } from '@msgpack/msgpack';
import WebSocket, { type RawData } from 'ws';

import type {
  NtClient,
  NtConnectionState,
  NtDiagnostic,
  NtEndpoint,
  NtStatusEvent,
  NtSubscriptionOptions,
  NtTopic,
  NtType,
  NtValue,
  NtValueUpdate,
} from './types.js';

const NT4_1_SUBPROTOCOL = 'v4.1.networktables.first.wpi.edu';
const NT4_0_SUBPROTOCOL = 'networktables.first.wpi.edu';

const typeCodes: Readonly<Record<NtType, number>> = {
  boolean: 0,
  double: 1,
  int: 2,
  float: 3,
  string: 4,
  json: 4,
  raw: 5,
  'boolean[]': 16,
  'double[]': 17,
  'int[]': 18,
  'float[]': 19,
  'string[]': 20,
};

const recognizedTypes = new Set<NtType>(Object.keys(typeCodes) as NtType[]);

interface StoredSubscription {
  readonly uid: number;
  readonly topics: readonly string[];
  readonly options: Required<NtSubscriptionOptions>;
}

interface Publisher {
  readonly uid: number;
  readonly topic: string;
  readonly type: NtType;
}

export interface Nt4ClientOptions {
  readonly autoReconnect?: boolean;
  readonly reconnectDelayMs?: number;
  readonly handshakeTimeoutMs?: number;
  readonly heartbeatIntervalMs?: number;
  readonly heartbeatTimeoutMs?: number;
}

export class Nt4Client implements NtClient {
  readonly #options: Required<Nt4ClientOptions>;
  readonly #statusListeners = new Set<(event: NtStatusEvent) => void>();
  readonly #valueListeners = new Set<(event: NtValueUpdate) => void>();
  readonly #diagnosticListeners = new Set<(event: NtDiagnostic) => void>();
  readonly #subscriptions = new Map<number, StoredSubscription>();
  readonly #publishers = new Map<string, Publisher>();
  readonly #topicsById = new Map<number, NtTopic>();
  readonly #topicsByName = new Map<string, NtTopic>();

  #state: NtConnectionState = 'idle';
  #socket: WebSocket | undefined;
  #endpoint?: NtEndpoint;
  #manualDisconnect = true;
  #nextSubscriptionUid = 1;
  #nextPublisherUid = 1;
  #reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  #heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  #lastPongMillis = 0;
  #bestRoundTripMicros = Number.POSITIVE_INFINITY;
  #serverTimeOffsetMicros = 0;
  #clockSynchronized = false;

  constructor(options: Nt4ClientOptions = {}) {
    this.#options = {
      autoReconnect: options.autoReconnect ?? true,
      handshakeTimeoutMs: options.handshakeTimeoutMs ?? 3_000,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? 200,
      heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 1_000,
      reconnectDelayMs: options.reconnectDelayMs ?? 500,
    };
  }

  get state(): NtConnectionState {
    return this.#state;
  }

  connect(endpoint: NtEndpoint): void {
    validateEndpoint(endpoint);
    this.disconnect();
    this.#endpoint = { ...endpoint };
    this.#manualDisconnect = false;
    this.#openSocket('connecting');
  }

  disconnect(): void {
    this.#manualDisconnect = true;
    this.#clearTimers();
    const socket = this.#socket;
    this.#socket = undefined;
    if (socket !== undefined && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000, 'Client disconnected');
    }
    this.#resetConnectionState();
    if (this.#state !== 'idle') {
      this.#setState('disconnected');
    }
  }

  subscribe(topics: readonly string[], options: NtSubscriptionOptions = {}): () => void {
    if (topics.length === 0 || topics.some((topic) => topic.length === 0)) {
      throw new TypeError('An NT subscription requires at least one non-empty topic.');
    }
    const subscription: StoredSubscription = {
      options: {
        allChanges: options.allChanges ?? false,
        periodicSeconds: options.periodicSeconds ?? 0.1,
        prefix: options.prefix ?? true,
        topicsOnly: options.topicsOnly ?? false,
      },
      topics: [...topics],
      uid: this.#nextSubscriptionUid++,
    };
    this.#subscriptions.set(subscription.uid, subscription);
    this.#sendSubscription(subscription);
    return () => {
      if (!this.#subscriptions.delete(subscription.uid)) {
        return;
      }
      this.#sendJson('unsubscribe', { subuid: subscription.uid });
    };
  }

  write(topic: string, type: NtType, value: NtValue): void {
    validateTopic(topic);
    validateValue(type, value);
    const socket = this.#connectedSocket();

    const announcedTopic = this.#topicsByName.get(topic);
    if (announcedTopic !== undefined && announcedTopic.type !== type) {
      throw new TypeError(
        `Topic ${topic} is announced as ${announcedTopic.type}, not the requested ${type}.`,
      );
    }

    let publisher = this.#publishers.get(topic);
    if (publisher !== undefined && publisher.type !== type) {
      throw new TypeError(`Publisher ${topic} is already configured as ${publisher.type}.`);
    }
    if (publisher === undefined) {
      publisher = { topic, type, uid: this.#nextPublisherUid++ };
      this.#publishers.set(topic, publisher);
      this.#sendJson('publish', {
        name: topic,
        properties: { cached: true, retained: true },
        pubuid: publisher.uid,
        type,
      });
    }

    const timestamp = this.#clockSynchronized
      ? Math.round(nowMicros() + this.#serverTimeOffsetMicros)
      : 0;
    socket.send(encode([publisher.uid, timestamp, typeCodes[type], value]));
  }

  onStatus(listener: (event: NtStatusEvent) => void): () => void {
    this.#statusListeners.add(listener);
    return () => this.#statusListeners.delete(listener);
  }

  onValue(listener: (event: NtValueUpdate) => void): () => void {
    this.#valueListeners.add(listener);
    return () => this.#valueListeners.delete(listener);
  }

  onDiagnostic(listener: (event: NtDiagnostic) => void): () => void {
    this.#diagnosticListeners.add(listener);
    return () => this.#diagnosticListeners.delete(listener);
  }

  #openSocket(state: 'connecting' | 'reconnecting'): void {
    const endpoint = this.#endpoint;
    if (endpoint === undefined || this.#manualDisconnect) {
      return;
    }
    this.#setState(state);
    const socket = new WebSocket(endpointUrl(endpoint), [NT4_1_SUBPROTOCOL, NT4_0_SUBPROTOCOL], {
      handshakeTimeout: this.#options.handshakeTimeoutMs,
      perMessageDeflate: false,
    });
    this.#socket = socket;

    socket.on('open', () => this.#handleOpen(socket));
    socket.on('message', (data, isBinary) => this.#handleMessage(data, isBinary));
    socket.on('pong', () => {
      this.#lastPongMillis = Date.now();
    });
    socket.on('error', (error) => {
      this.#diagnostic({ code: 'connection-error', message: error.message });
      this.#setState('error', error.message);
    });
    socket.on('close', () => this.#handleClose(socket));
  }

  #handleOpen(socket: WebSocket): void {
    if (socket !== this.#socket) {
      socket.close();
      return;
    }
    this.#resetConnectionState();
    this.#lastPongMillis = Date.now();
    this.#setState('connected', socket.protocol);
    this.#sendTimestampProbe();
    for (const subscription of this.#subscriptions.values()) {
      this.#sendSubscription(subscription);
    }
    for (const publisher of this.#publishers.values()) {
      this.#sendPublish(publisher);
    }
    this.#heartbeatTimer = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }
      if (Date.now() - this.#lastPongMillis > this.#options.heartbeatTimeoutMs) {
        this.#diagnostic({
          code: 'connection-error',
          message: 'NT4 heartbeat timed out; reconnecting.',
        });
        socket.terminate();
        return;
      }
      socket.ping();
    }, this.#options.heartbeatIntervalMs);
  }

  #handleClose(socket: WebSocket): void {
    if (socket !== this.#socket) {
      return;
    }
    this.#socket = undefined;
    this.#clearHeartbeat();
    this.#resetConnectionState();
    if (this.#manualDisconnect) {
      this.#setState('disconnected');
      return;
    }
    if (!this.#options.autoReconnect) {
      this.#setState('disconnected');
      return;
    }
    this.#setState('reconnecting');
    this.#reconnectTimer = setTimeout(
      () => this.#openSocket('reconnecting'),
      this.#options.reconnectDelayMs,
    );
  }

  #handleMessage(data: RawData, isBinary: boolean): void {
    try {
      if (isBinary) {
        this.#handleBinary(new Uint8Array(data as Buffer));
      } else {
        this.#handleText(data.toString());
      }
    } catch (error) {
      this.#diagnostic({
        code: isBinary ? 'invalid-value-message' : 'invalid-control-message',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  #handleText(text: string): void {
    const messages: unknown = JSON.parse(text);
    if (!Array.isArray(messages)) {
      throw new TypeError('NT4 control frame must be a JSON array.');
    }
    for (const message of messages) {
      if (!isRecord(message) || typeof message.method !== 'string' || !isRecord(message.params)) {
        continue;
      }
      if (message.method === 'announce') {
        this.#announce(message.params);
      } else if (message.method === 'unannounce' && typeof message.params.id === 'number') {
        const topic = this.#topicsById.get(message.params.id);
        if (topic !== undefined) {
          this.#topicsById.delete(topic.id);
          this.#topicsByName.delete(topic.name);
        }
      }
    }
  }

  #announce(params: Record<string, unknown>): void {
    if (
      typeof params.id !== 'number' ||
      typeof params.name !== 'string' ||
      typeof params.type !== 'string' ||
      !recognizedTypes.has(params.type as NtType)
    ) {
      throw new TypeError('Invalid NT4 topic announcement.');
    }
    const existing = this.#topicsById.get(params.id) ?? this.#topicsByName.get(params.name);
    if (existing !== undefined && existing.type !== params.type) {
      this.#diagnostic({
        code: 'topic-type-changed',
        message: `${params.name} changed type from ${existing.type} to ${params.type}.`,
      });
      this.#topicsById.delete(existing.id);
    }
    const topic: NtTopic = {
      id: params.id,
      name: params.name,
      properties: isRecord(params.properties) ? params.properties : {},
      type: params.type as NtType,
    };
    this.#topicsById.set(topic.id, topic);
    this.#topicsByName.set(topic.name, topic);
  }

  #handleBinary(data: Uint8Array): void {
    // JavaScript numbers exactly represent the current microsecond epoch and NT4
    // timestamps for centuries. Keeping timestamps as numbers also avoids leaking
    // bigint values through the public renderer-safe API.
    for (const decoded of decodeMulti(data)) {
      if (!Array.isArray(decoded) || decoded.length < 4) {
        throw new TypeError('NT4 value message must be a four-element MessagePack array.');
      }
      const [rawId, rawTimestamp, rawTypeCode, rawValue] = decoded;
      if (typeof rawId !== 'number' || typeof rawTypeCode !== 'number') {
        throw new TypeError('NT4 value message contains invalid IDs.');
      }
      const timestamp = numericValue(rawTimestamp);
      if (rawId === -1) {
        this.#handleTimestamp(timestamp, rawValue);
        continue;
      }
      const topic = this.#topicsById.get(rawId);
      if (topic === undefined) {
        continue;
      }
      if (typeCodes[topic.type] !== rawTypeCode) {
        this.#diagnostic({
          code: 'topic-type-mismatch',
          message: `${topic.name} announced ${topic.type} but received type code ${rawTypeCode}.`,
        });
        continue;
      }
      validateValue(topic.type, rawValue);
      const update: NtValueUpdate = {
        timestampMicros: timestamp,
        topic,
        value: normalizeValue(rawValue),
      };
      for (const listener of this.#valueListeners) {
        listener(update);
      }
    }
  }

  #handleTimestamp(serverTimestamp: number, rawClientTimestamp: unknown): void {
    const clientTimestamp = numericValue(rawClientTimestamp);
    const current = nowMicros();
    const roundTrip = current - clientTimestamp;
    if (roundTrip >= 0 && roundTrip < this.#bestRoundTripMicros) {
      this.#bestRoundTripMicros = roundTrip;
      this.#serverTimeOffsetMicros = serverTimestamp + roundTrip / 2 - current;
      this.#clockSynchronized = true;
    }
  }

  #sendTimestampProbe(): void {
    this.#connectedSocket().send(encode([-1, 0, 2, Math.round(nowMicros())]));
  }

  #sendSubscription(subscription: StoredSubscription): void {
    this.#sendJson('subscribe', {
      options: {
        all: subscription.options.allChanges,
        periodic: subscription.options.periodicSeconds,
        prefix: subscription.options.prefix,
        topicsonly: subscription.options.topicsOnly,
      },
      subuid: subscription.uid,
      topics: subscription.topics,
    });
  }

  #sendPublish(publisher: Publisher): void {
    this.#sendJson('publish', {
      name: publisher.topic,
      properties: { cached: true, retained: true },
      pubuid: publisher.uid,
      type: publisher.type,
    });
  }

  #sendJson(method: string, params: Record<string, unknown>): void {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      return;
    }
    this.#socket.send(JSON.stringify([{ method, params }]));
  }

  #connectedSocket(): WebSocket {
    if (this.#socket?.readyState !== WebSocket.OPEN) {
      throw new Error('NT4 client is not connected.');
    }
    return this.#socket;
  }

  #setState(state: NtConnectionState, detail?: string): void {
    if (state === this.#state && detail === undefined) {
      return;
    }
    this.#state = state;
    const event: NtStatusEvent = { state, ...(detail === undefined ? {} : { detail }) };
    for (const listener of this.#statusListeners) {
      listener(event);
    }
  }

  #diagnostic(event: NtDiagnostic): void {
    for (const listener of this.#diagnosticListeners) {
      listener(event);
    }
  }

  #clearTimers(): void {
    if (this.#reconnectTimer !== undefined) {
      clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = undefined;
    }
    this.#clearHeartbeat();
  }

  #clearHeartbeat(): void {
    if (this.#heartbeatTimer !== undefined) {
      clearInterval(this.#heartbeatTimer);
      this.#heartbeatTimer = undefined;
    }
  }

  #resetConnectionState(): void {
    this.#topicsById.clear();
    this.#topicsByName.clear();
    this.#clockSynchronized = false;
    this.#bestRoundTripMicros = Number.POSITIVE_INFINITY;
    this.#serverTimeOffsetMicros = 0;
  }
}

function endpointUrl(endpoint: NtEndpoint): string {
  const protocol = endpoint.secure === true ? 'wss' : 'ws';
  const host = endpoint.host.includes(':') ? `[${endpoint.host}]` : endpoint.host;
  const clientName = encodeURIComponent(endpoint.clientName ?? 'FRCFramework');
  return `${protocol}://${host}:${endpoint.port ?? (endpoint.secure === true ? 5811 : 5810)}/nt/${clientName}`;
}

function validateEndpoint(endpoint: NtEndpoint): void {
  if (endpoint.host.trim().length === 0) {
    throw new TypeError('NT4 host cannot be empty.');
  }
  if (endpoint.clientName?.includes('@') === true) {
    throw new TypeError('NT4 client names cannot contain @.');
  }
  const port = endpoint.port ?? (endpoint.secure === true ? 5811 : 5810);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new TypeError(`Invalid NT4 port: ${port}`);
  }
}

function validateTopic(topic: string): void {
  if (!topic.startsWith('/') || topic.includes('//')) {
    throw new TypeError(`NT topic must be an absolute path without empty segments: ${topic}`);
  }
}

function validateValue(type: NtType, value: unknown): asserts value is NtValue {
  const valid =
    (type === 'boolean' && typeof value === 'boolean') ||
    (['double', 'int', 'float'].includes(type) && typeof value === 'number') ||
    (['string', 'json'].includes(type) && typeof value === 'string') ||
    (type === 'raw' && (value instanceof Uint8Array || Buffer.isBuffer(value))) ||
    (type === 'boolean[]' &&
      Array.isArray(value) &&
      value.every((item) => typeof item === 'boolean')) ||
    (['double[]', 'int[]', 'float[]'].includes(type) &&
      Array.isArray(value) &&
      value.every((item) => typeof item === 'number')) ||
    (type === 'string[]' &&
      Array.isArray(value) &&
      value.every((item) => typeof item === 'string'));
  if (!valid) {
    throw new TypeError(`Value does not match NT type ${type}.`);
  }
}

function normalizeValue(value: NtValue): NtValue {
  return Buffer.isBuffer(value) ? new Uint8Array(value) : value;
}

function numericValue(value: unknown): number {
  if (typeof value === 'bigint') {
    return Number(value);
  }
  if (typeof value !== 'number') {
    throw new TypeError('Expected a numeric NT timestamp.');
  }
  return value;
}

function nowMicros(): number {
  return performance.timeOrigin * 1_000 + performance.now() * 1_000;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
