import { contextBridge, ipcRenderer } from 'electron';

import type { AppEvent, AudioDevice, CaptionSegment, StartSessionRequest } from '@echo-bridge/shared';

export interface EchoBridgeApi {
  listDevices(): Promise<AudioDevice[]>;
  startSession(request: StartSessionRequest): Promise<{ sessionId: string }>;
  stopSession(): Promise<CaptionSegment[]>;
  onEvent(listener: (event: AppEvent) => void): () => void;
}

const api: EchoBridgeApi = {
  listDevices: () => ipcRenderer.invoke('devices:list') as Promise<AudioDevice[]>,
  startSession: (request) =>
    ipcRenderer.invoke('session:start', request) as Promise<{ sessionId: string }>,
  stopSession: () => ipcRenderer.invoke('session:stop') as Promise<CaptionSegment[]>,
  onEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, appEvent: AppEvent) => listener(appEvent);
    ipcRenderer.on('app:event', wrapped);
    return () => ipcRenderer.off('app:event', wrapped);
  },
};

contextBridge.exposeInMainWorld('echoBridge', api);
