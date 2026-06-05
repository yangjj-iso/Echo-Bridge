import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

import type { AppEvent, AudioDevice, CaptionSegment, StartSessionRequest } from '@echo-bridge/shared';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const apiBaseUrl = process.env.ECHO_BRIDGE_API_URL ?? 'http://127.0.0.1:4317';
const apiEventsUrl = apiBaseUrl.replace(/^http/, 'ws') + '/events';

let mainWindow: BrowserWindow | undefined;
let eventSocket: WebSocket | undefined;

function sendEvent(event: AppEvent): void {
  mainWindow?.webContents.send('app:event', event);
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 960,
    minHeight: 640,
    title: 'EchoBridge AI',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(dirname, '../../dist/index.html'));
  }

  connectEventSocket();
}

ipcMain.handle('devices:list', async () => {
  const payload = await requestJson<{ devices: AudioDevice[] }>('/devices');
  return payload.devices;
});

ipcMain.handle('session:start', async (_event, request: StartSessionRequest) => {
  return requestJson<{ sessionId: string }>('/sessions', {
    method: 'POST',
    body: JSON.stringify(request),
  });
});

ipcMain.handle('session:stop', async () => {
  const payload = await requestJson<{ captions: CaptionSegment[] }>('/sessions/stop', {
    method: 'POST',
  });
  return payload.captions;
});

void app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    eventSocket?.close();
    app.quit();
  }
});

function connectEventSocket(): void {
  eventSocket?.close();
  eventSocket = new WebSocket(apiEventsUrl);

  eventSocket.on('message', (data) => {
    sendEvent(JSON.parse(data.toString()) as AppEvent);
  });

  eventSocket.on('error', (error) => {
    sendEvent({
      type: 'app.error',
      error: {
        code: 'UNKNOWN',
        message: 'EchoBridge API event stream is unavailable.',
        recoverable: true,
        cause: error.message,
      },
    });
  });
}

async function requestJson<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${pathname}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...init.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`EchoBridge API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}
