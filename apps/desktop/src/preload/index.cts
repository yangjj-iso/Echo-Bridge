import { contextBridge, ipcRenderer } from 'electron';

import type {
  AppEvent,
  AudioDevice,
  CaptionSegment,
  SessionHistoryItem,
  SessionRecord,
  StartSessionRequest,
} from '@echo-bridge/shared';

export interface ExportUrls {
  markdown: string;
  srt: string;
}

export interface HealthStatus {
  ok: boolean;
  service: string;
  aiProvider: string;
  aiProviderMode: string;
}

export interface DiagnosticsStatus {
  ok: boolean;
  audio: {
    ready: boolean;
    deviceCount: number;
    defaultDeviceLabel?: string;
    message: string;
  };
  ai: {
    ready: boolean;
    provider: string;
    mode: string;
    hasApiKey: boolean;
    transcriptionModel?: string;
    translationModel?: string;
    realtimeModel?: string;
    message: string;
  };
}

export interface EchoBridgeApi {
  getHealth(): Promise<HealthStatus>;
  getDiagnostics(): Promise<DiagnosticsStatus>;
  listDevices(): Promise<AudioDevice[]>;
  startSession(request: StartSessionRequest): Promise<{ sessionId: string }>;
  pauseSession(): Promise<void>;
  resumeSession(): Promise<void>;
  stopSession(): Promise<CaptionSegment[]>;
  getCurrentRecord(): Promise<{ record: SessionRecord; stats: unknown }>;
  getExportUrls(): Promise<ExportUrls>;
  listHistory(): Promise<{ sessions: SessionHistoryItem[] }>;
  getHistoryRecord(sessionId: string): Promise<{ record: SessionRecord; stats: unknown }>;
  getHistoryExportUrls(sessionId: string): Promise<ExportUrls>;
  openMiniWindow(): Promise<void>;
  onEvent(listener: (event: AppEvent) => void): () => void;
}

const api: EchoBridgeApi = {
  getHealth: () => ipcRenderer.invoke('health:get') as Promise<HealthStatus>,
  getDiagnostics: () => ipcRenderer.invoke('diagnostics:get') as Promise<DiagnosticsStatus>,
  listDevices: () => ipcRenderer.invoke('devices:list') as Promise<AudioDevice[]>,
  startSession: (request) =>
    ipcRenderer.invoke('session:start', request) as Promise<{ sessionId: string }>,
  pauseSession: () => ipcRenderer.invoke('session:pause') as Promise<void>,
  resumeSession: () => ipcRenderer.invoke('session:resume') as Promise<void>,
  stopSession: () => ipcRenderer.invoke('session:stop') as Promise<CaptionSegment[]>,
  getCurrentRecord: () =>
    ipcRenderer.invoke('session:record') as Promise<{ record: SessionRecord; stats: unknown }>,
  getExportUrls: () => ipcRenderer.invoke('exports:urls') as Promise<ExportUrls>,
  listHistory: () =>
    ipcRenderer.invoke('history:list') as Promise<{ sessions: SessionHistoryItem[] }>,
  getHistoryRecord: (sessionId) =>
    ipcRenderer.invoke('history:record', sessionId) as Promise<{
      record: SessionRecord;
      stats: unknown;
    }>,
  getHistoryExportUrls: (sessionId) =>
    ipcRenderer.invoke('history:exports', sessionId) as Promise<ExportUrls>,
  openMiniWindow: () => ipcRenderer.invoke('window:mini') as Promise<void>,
  onEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, appEvent: AppEvent) => listener(appEvent);
    ipcRenderer.on('app:event', wrapped);
    return () => ipcRenderer.off('app:event', wrapped);
  },
};

contextBridge.exposeInMainWorld('echoBridge', api);
