/// <reference types="vite/client" />

import type { EchoBridgeApi } from '../preload/index.js';

declare global {
  interface Window {
    echoBridge: EchoBridgeApi;
  }
}
