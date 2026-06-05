/// <reference types="vite/client" />

import type { EchoBridgeApi } from '../preload/index.cjs';

declare global {
  interface Window {
    echoBridge: EchoBridgeApi;
  }
}
