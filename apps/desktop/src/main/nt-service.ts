import {
  Nt4Client,
  type NtClient,
  type NtDiagnostic,
  type NtStatusEvent,
} from '@frc-framework/nt-client';

import type {
  CalibrationTestRequest,
  NtConnectRequest,
  NtLiveValueView,
  NtSnapshotView,
} from '../shared/ipc.js';

export class NtService {
  readonly #client: NtClient;
  readonly #values = new Map<string, NtLiveValueView>();
  #detail: string | undefined;
  #lastUpdatedAtMillis: number | undefined;
  #unsubscribe: (() => void) | undefined;
  #calibrationTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(client: NtClient = new Nt4Client()) {
    this.#client = client;
    client.onStatus((event) => this.#onStatus(event));
    client.onDiagnostic((diagnostic) => this.#onDiagnostic(diagnostic));
    client.onValue((event) => {
      const updatedAtMillis = Date.now();
      this.#lastUpdatedAtMillis = updatedAtMillis;
      this.#values.set(event.topic.name, {
        path: event.topic.name,
        type: event.topic.type,
        updatedAtMillis,
        value: event.value,
      });
    });
  }

  connect(request: NtConnectRequest): NtSnapshotView {
    validateRequest(request);
    this.#unsubscribe?.();
    this.#values.clear();
    this.#lastUpdatedAtMillis = undefined;
    this.#detail = undefined;
    this.#unsubscribe = this.#client.subscribe(request.prefixes, {
      allChanges: false,
      periodicSeconds: 0.1,
      prefix: true,
    });
    this.#client.connect({ clientName: 'FRC-Framework', host: request.host });
    return this.snapshot();
  }

  disconnect(): NtSnapshotView {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#client.disconnect();
    return this.snapshot();
  }

  snapshot(nowMillis = Date.now()): NtSnapshotView {
    const stale =
      this.#client.state === 'connected' &&
      this.#lastUpdatedAtMillis !== undefined &&
      nowMillis - this.#lastUpdatedAtMillis > 2_000;
    return {
      ...(this.#detail === undefined ? {} : { detail: this.#detail }),
      ...(this.#lastUpdatedAtMillis === undefined
        ? {}
        : { lastUpdatedAtMillis: this.#lastUpdatedAtMillis }),
      state: stale ? 'stale' : this.#client.state,
      values: [...this.#values.values()].sort((left, right) => left.path.localeCompare(right.path)),
    };
  }

  startCalibrationTest(request: CalibrationTestRequest): NtSnapshotView {
    if (!request.confirmed)
      throw new Error('Low-power calibration requires explicit confirmation.');
    if (!/^[0-9a-f-]{36}$/iu.test(request.deviceId))
      throw new Error('Invalid calibration device ID.');
    if (!Number.isFinite(request.output) || Math.abs(request.output) > 0.15)
      throw new Error('Calibration output is limited to 15%.');
    if (
      !Number.isFinite(request.durationSeconds) ||
      request.durationSeconds < 0.05 ||
      request.durationSeconds > 2
    )
      throw new Error('Calibration duration must be between 0.05 and 2 seconds.');
    this.stopCalibrationTest();
    this.#client.write('/FRCFramework/Calibration/DeviceId', 'string', request.deviceId);
    this.#client.write('/FRCFramework/Calibration/Output', 'double', request.output);
    this.#client.write(
      '/FRCFramework/Calibration/DurationSeconds',
      'double',
      request.durationSeconds,
    );
    this.#client.write('/FRCFramework/Calibration/Enabled', 'boolean', true);
    this.#calibrationTimer = setTimeout(
      () => this.stopCalibrationTest(),
      Math.ceil(request.durationSeconds * 1000) + 100,
    );
    return this.snapshot();
  }

  stopCalibrationTest(): NtSnapshotView {
    if (this.#calibrationTimer !== undefined) clearTimeout(this.#calibrationTimer);
    this.#calibrationTimer = undefined;
    if (this.#client.state === 'connected') {
      this.#client.write('/FRCFramework/Calibration/Enabled', 'boolean', false);
    }
    return this.snapshot();
  }

  dispose(): void {
    if (this.#calibrationTimer !== undefined) clearTimeout(this.#calibrationTimer);
    this.disconnect();
  }

  #onStatus(event: NtStatusEvent): void {
    this.#detail = event.detail;
  }

  #onDiagnostic(diagnostic: NtDiagnostic): void {
    this.#detail = diagnostic.message.slice(0, 500);
  }
}

function validateRequest(request: NtConnectRequest): void {
  if (!/^[A-Za-z0-9.:-]{1,255}$/u.test(request.host)) {
    throw new Error('NT host must be a hostname or IPv4/IPv6 address without a URL scheme.');
  }
  if (
    request.prefixes.length === 0 ||
    request.prefixes.length > 100 ||
    request.prefixes.some((prefix) => !prefix.startsWith('/') || prefix.length > 512)
  ) {
    throw new Error('NT subscriptions must contain 1–100 absolute project paths.');
  }
}
