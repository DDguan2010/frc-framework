import type {
  NtClient,
  NtConnectionState,
  NtDiagnostic,
  NtEndpoint,
  NtStatusEvent,
  NtSubscriptionOptions,
  NtValueUpdate,
  NtType,
  NtValue,
} from '@frc-framework/nt-client';
import { describe, expect, it } from 'vitest';

import { NtService } from './nt-service.js';

class FakeNtClient implements NtClient {
  state: NtConnectionState = 'idle';
  readonly statuses = new Set<(event: NtStatusEvent) => void>();
  readonly values = new Set<(event: NtValueUpdate) => void>();
  readonly diagnostics = new Set<(event: NtDiagnostic) => void>();
  subscribed: readonly string[] = [];
  readonly writes: Array<{ topic: string; type: NtType; value: NtValue }> = [];

  connect(_endpoint: NtEndpoint): void {
    this.state = 'connected';
    this.statuses.forEach((listener) => listener({ state: 'connected' }));
  }
  disconnect(): void {
    this.state = 'disconnected';
  }
  subscribe(topics: readonly string[], _options?: NtSubscriptionOptions): () => void {
    this.subscribed = topics;
    return () => {
      this.subscribed = [];
    };
  }
  write(topic: string, type: NtType, value: NtValue): void {
    this.writes.push({ topic, type, value });
  }
  onStatus(listener: (event: NtStatusEvent) => void): () => void {
    this.statuses.add(listener);
    return () => this.statuses.delete(listener);
  }
  onValue(listener: (event: NtValueUpdate) => void): () => void {
    this.values.add(listener);
    return () => this.values.delete(listener);
  }
  onDiagnostic(listener: (event: NtDiagnostic) => void): () => void {
    this.diagnostics.add(listener);
    return () => this.diagnostics.delete(listener);
  }
}

describe('Electron NT service', () => {
  it('subscribes only declared prefixes and returns serializable snapshots', () => {
    const client = new FakeNtClient();
    const service = new NtService(client);
    expect(service.connect({ host: '127.0.0.1', prefixes: ['/Tuning/Shooter'] }).state).toBe(
      'connected',
    );
    expect(client.subscribed).toEqual(['/Tuning/Shooter']);
    client.values.forEach((listener) =>
      listener({
        timestampMicros: 10,
        topic: { id: 1, name: '/Tuning/Shooter/kP', properties: {}, type: 'double' },
        value: 0.2,
      }),
    );
    expect(service.snapshot()).toMatchObject({
      state: 'connected',
      values: [{ path: '/Tuning/Shooter/kP', type: 'double', value: 0.2 }],
    });
  });

  it('rejects URL schemes and broad or relative subscriptions', () => {
    const service = new NtService(new FakeNtClient());
    expect(() => service.connect({ host: 'ws://robot', prefixes: ['/Tuning'] })).toThrow(
      'hostname',
    );
    expect(() => service.connect({ host: 'localhost', prefixes: [] })).toThrow('1–100');
    expect(() => service.connect({ host: 'localhost', prefixes: [''] })).toThrow('absolute');
  });

  it('guards low-power calibration output and sends an explicit stop', () => {
    const client = new FakeNtClient();
    const service = new NtService(client);
    service.connect({ host: 'localhost', prefixes: ['/FRCFramework/Calibration'] });
    expect(() =>
      service.startCalibrationTest({
        confirmed: false,
        deviceId: 'e936f1cc-40ce-476a-b37f-99303195db93',
        durationSeconds: 0.5,
        output: 0.1,
      }),
    ).toThrow('confirmation');
    expect(() =>
      service.startCalibrationTest({
        confirmed: true,
        deviceId: 'e936f1cc-40ce-476a-b37f-99303195db93',
        durationSeconds: 0.5,
        output: 0.2,
      }),
    ).toThrow('15%');
    service.startCalibrationTest({
      confirmed: true,
      deviceId: 'e936f1cc-40ce-476a-b37f-99303195db93',
      durationSeconds: 0.5,
      output: 0.1,
    });
    expect(client.writes).toContainEqual({
      topic: '/FRCFramework/Calibration/Enabled',
      type: 'boolean',
      value: true,
    });
    service.stopCalibrationTest();
    expect(client.writes.at(-1)).toMatchObject({
      topic: '/FRCFramework/Calibration/Enabled',
      value: false,
    });
  });
});
