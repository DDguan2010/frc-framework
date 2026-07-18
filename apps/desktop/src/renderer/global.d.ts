import type { FrameworkApi } from '../shared/ipc.js';

declare global {
  interface Window {
    readonly framework: FrameworkApi;
  }
}

export {};
