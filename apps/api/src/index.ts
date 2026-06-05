import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import { MockAudioCaptureSource } from '@echo-bridge/audio';
import { InterpretationPipeline } from '@echo-bridge/pipeline';
import type { AppEvent, StartSessionRequest } from '@echo-bridge/shared';
import { MockTranscriptionProvider } from '@echo-bridge/transcription';
import { MockTranslationProvider } from '@echo-bridge/translation';

const port = Number(process.env.ECHO_BRIDGE_API_PORT ?? 4317);
const audioSource = new MockAudioCaptureSource();
const pipeline = new InterpretationPipeline({
  audioSource,
  transcriptionProvider: new MockTranscriptionProvider(),
  translationProvider: new MockTranslationProvider(),
});

const app = express();
const server = createServer(app);
const sockets = new Set<WebSocket>();
const wss = new WebSocketServer({ server, path: '/events' });

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_request, response) => {
  response.json({ ok: true, service: 'echo-bridge-api' });
});

app.get('/devices', async (_request, response, next) => {
  try {
    const devices = await audioSource.listOutputDevices();
    emit({ type: 'devices.updated', devices });
    response.json({ devices });
  } catch (error) {
    next(error);
  }
});

app.post('/sessions', async (request, response, next) => {
  try {
    const result = await pipeline.start(parseStartSessionRequest(request.body), emit);
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/sessions/stop', async (_request, response, next) => {
  try {
    const captions = await pipeline.stop(emit);
    response.json({ captions });
  } catch (error) {
    next(error);
  }
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  void _next;
  const message = error instanceof Error ? error.message : 'Unexpected API error.';
  response.status(500).json({
    error: {
      code: 'UNKNOWN',
      message,
      recoverable: true,
    },
  });
});

wss.on('connection', (socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`EchoBridge API listening on http://127.0.0.1:${port}`);
});

function emit(event: AppEvent): void {
  const payload = JSON.stringify(event);

  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}

function parseStartSessionRequest(value: unknown): StartSessionRequest {
  const body = value as Partial<StartSessionRequest>;

  if (!body.deviceId || !body.sourceLanguage || !body.targetLanguage || !body.latencyMode) {
    throw new Error('Invalid start session request.');
  }

  return {
    deviceId: body.deviceId,
    sourceLanguage: body.sourceLanguage,
    targetLanguage: body.targetLanguage,
    latencyMode: body.latencyMode,
  };
}
