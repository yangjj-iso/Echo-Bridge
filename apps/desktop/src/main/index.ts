import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { MockAudioCaptureSource, type AudioCaptureSession } from '@echo-bridge/audio';
import { CaptionStore } from '@echo-bridge/captions';
import type { AppEvent, CaptionSegment, StartSessionRequest } from '@echo-bridge/shared';
import { MockTranscriptionProvider, type TranscriptionProvider } from '@echo-bridge/transcription';
import { MockTranslationProvider, type TranslationProvider } from '@echo-bridge/translation';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const audioSource = new MockAudioCaptureSource();
const captions = new CaptionStore();
const transcriptionProvider: TranscriptionProvider = new MockTranscriptionProvider();
const translationProvider: TranslationProvider = new MockTranslationProvider();

let mainWindow: BrowserWindow | undefined;
let captureSession: AudioCaptureSession | undefined;

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
  if (captureSession) {
    await captureSession.stop();
  }

  sendEvent({ type: 'session.status', status: 'starting' });

  captureSession = await audioSource.start(request.deviceId, (chunk) => {
    void transcriptionProvider
      .acceptAudio(chunk)
      .then(async (transcripts) => {
        for (const transcript of transcripts) {
          const caption: CaptionSegment = captions.upsert({
            id: transcript.id,
            startMs: transcript.startMs,
            endMs: transcript.endMs,
            sourceText: transcript.text,
            status: transcript.isFinal ? 'final' : 'partial',
            confidence: transcript.confidence,
            revision: 0,
          });
          const translation = await translationProvider.translateSegment(caption, captions.list());
          const translatedCaption = captions.upsert({
            ...caption,
            translatedText: translation.translatedText,
          });

          sendEvent({ type: 'caption.upserted', caption: translatedCaption });

          for (const revision of translation.revisions) {
            const revised = captions.revise(revision);
            sendEvent({ type: 'caption.revised', revision });
            sendEvent({ type: 'caption.upserted', caption: revised });
          }
        }
      })
      .catch((error: unknown) => {
        sendEvent({
          type: 'app.error',
          error: {
            code: 'TRANSCRIPTION_FAILED',
            message: 'Failed to process audio chunk.',
            recoverable: true,
            cause: error instanceof Error ? error.message : String(error),
          },
        });
      });
  });

  sendEvent({ type: 'session.status', status: 'listening' });
  return { sessionId: captureSession.id };
});

ipcMain.handle('session:stop', async () => {
  sendEvent({ type: 'session.status', status: 'stopping' });
  await captureSession?.stop();
  await transcriptionProvider.close();
  captureSession = undefined;
  sendEvent({ type: 'session.status', status: 'idle' });
  return captions.list();
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
