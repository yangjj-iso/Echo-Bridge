import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MockAudioCaptureSource } from '@echo-bridge/audio';
import { InterpretationPipeline } from '@echo-bridge/pipeline';
import type { AppEvent, StartSessionRequest } from '@echo-bridge/shared';
import { MockTranscriptionProvider } from '@echo-bridge/transcription';
import { MockTranslationProvider } from '@echo-bridge/translation';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const audioSource = new MockAudioCaptureSource();
const pipeline = new InterpretationPipeline({
  audioSource,
  transcriptionProvider: new MockTranscriptionProvider(),
  translationProvider: new MockTranslationProvider(),
});

let mainWindow: BrowserWindow | undefined;

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
}

ipcMain.handle('devices:list', async () => {
  const devices = await audioSource.listOutputDevices();
  sendEvent({ type: 'devices.updated', devices });
  return devices;
});

ipcMain.handle('session:start', async (_event, request: StartSessionRequest) => {
  return pipeline.start(request, sendEvent);
});

ipcMain.handle('session:stop', async () => {
  return pipeline.stop(sendEvent);
});

void app.whenReady().then(createWindow);

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
