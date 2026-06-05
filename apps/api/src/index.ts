import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import { createAiProvidersFromEnv } from '@echo-bridge/ai';
import { createAudioCaptureSource } from '@echo-bridge/audio';
import {
  exportMarkdown,
  exportSrt,
  generateSessionSummary,
  summarizeCaptions,
} from '@echo-bridge/captions';
import { InterpretationPipeline } from '@echo-bridge/pipeline';
import {
  EchoBridgeError,
  type AppEvent,
  type CaptionSegment,
  type SessionRecord,
} from '@echo-bridge/shared';

import { listSessionHistory, readSessionRecord, saveSessionRecord } from './sessionHistory.js';
import { ApiRequestError, parseStartSessionRequest } from './startSessionRequest.js';

const port = Number(process.env.ECHO_BRIDGE_API_PORT ?? 4317);
const audioSource = createAudioCaptureSource();
const aiProviders = createAiProvidersFromEnv();
const pipeline = new InterpretationPipeline({
  audioSource,
  transcriptionProvider: aiProviders.transcriptionProvider,
  translationProvider: aiProviders.translationProvider,
});

const app = express();
const server = createServer(app);
const sockets = new Set<WebSocket>();
const wss = new WebSocketServer({ server, path: '/events' });
let sessionRecord: SessionRecord = {
  status: 'idle',
  captions: [],
};

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_request, response) => {
  response.json({
    ok: true,
    service: 'echo-bridge-api',
    aiProvider: aiProviders.providerName,
    aiProviderMode: aiProviders.providerMode,
  });
});

app.get('/diagnostics', async (_request, response) => {
  const audio = await getAudioDiagnostics();
  const ai = getAiDiagnostics(process.env);

  response.json({
    ok: audio.ready && ai.ready,
    audio,
    ai,
  });
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
    const startRequest = parseStartSessionRequest(request.body);
    sessionRecord = {
      status: 'starting',
      captions: [],
    };
    const result = await pipeline.start(startRequest, emit);
    sessionRecord = {
      sessionId: result.sessionId,
      startedAt: new Date().toISOString(),
      status: 'listening',
      captions: [],
    };
    emit({ type: 'session.status', status: 'listening' });
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/sessions/stop', async (_request, response, next) => {
  try {
    const captions = await pipeline.stop(emit);
    const summary = sessionRecord.sessionId
      ? generateSessionSummary(sessionRecord.sessionId, captions)
      : undefined;
    sessionRecord = {
      ...sessionRecord,
      endedAt: new Date().toISOString(),
      status: 'idle',
      captions,
      summary,
    };
    if (summary) {
      emit({ type: 'session.summary', summary });
    }
    const historyItem = await saveSessionRecord(sessionRecord);
    response.json({ captions, historyItem, summary });
  } catch (error) {
    next(error);
  }
});

app.post('/sessions/pause', (_request, response, next) => {
  try {
    pipeline.pause(emit);
    response.json({ status: 'paused' });
  } catch (error) {
    next(error);
  }
});

app.post('/sessions/resume', (_request, response, next) => {
  try {
    pipeline.resume(emit);
    response.json({ status: 'listening' });
  } catch (error) {
    next(error);
  }
});

app.get('/sessions/history', async (_request, response, next) => {
  try {
    response.json({ sessions: await listSessionHistory() });
  } catch (error) {
    next(error);
  }
});

app.get('/sessions/history/:sessionId', async (request, response, next) => {
  try {
    const record = await readSessionRecord(request.params.sessionId);

    if (!record) {
      response.status(404).json({ error: { code: 'UNKNOWN', message: 'Session not found.' } });
      return;
    }

    response.json({ record: withSummary(record), stats: summarizeCaptions(record.captions) });
  } catch (error) {
    next(error);
  }
});

app.get('/sessions/history/:sessionId/export.md', async (request, response, next) => {
  try {
    const record = await readSessionRecord(request.params.sessionId);

    if (!record) {
      response.status(404).send('Session not found.');
      return;
    }

    const recordWithSummary = withSummary(record);
    response.type('text/markdown').send(exportMarkdown(record.captions, recordWithSummary.summary));
  } catch (error) {
    next(error);
  }
});

app.get('/sessions/history/:sessionId/export.srt', async (request, response, next) => {
  try {
    const record = await readSessionRecord(request.params.sessionId);

    if (!record) {
      response.status(404).send('Session not found.');
      return;
    }

    response.type('application/x-subrip').send(exportSrt(record.captions));
  } catch (error) {
    next(error);
  }
});

app.get('/sessions/current/captions', (_request, response) => {
  response.json({ captions: sessionRecord.captions });
});

app.get('/sessions/current/record', (_request, response) => {
  response.json({
    record: withSummary(sessionRecord),
    stats: summarizeCaptions(sessionRecord.captions),
  });
});

app.get('/sessions/current/export.md', (_request, response) => {
  const record = withSummary(sessionRecord);
  response.type('text/markdown').send(exportMarkdown(record.captions, record.summary));
});

app.get('/sessions/current/export.srt', (_request, response) => {
  response.type('application/x-subrip').send(exportSrt(sessionRecord.captions));
});

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  void _next;
  const apiError = normalizeApiError(error);
  response.status(apiError.status).json({
    error: {
      code: apiError.code,
      message: apiError.message,
      recoverable: apiError.recoverable,
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
  applyEventToRecord(event);
  const payload = JSON.stringify(event);

  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}

function applyEventToRecord(event: AppEvent): void {
  switch (event.type) {
    case 'session.status':
      sessionRecord = {
        ...sessionRecord,
        status: event.status,
        endedAt: event.status === 'idle' ? new Date().toISOString() : sessionRecord.endedAt,
      };
      break;
    case 'caption.upserted':
      sessionRecord = {
        ...sessionRecord,
        captions: upsertCaption(sessionRecord.captions, event.caption),
      };
      break;
    case 'caption.revised':
    case 'devices.updated':
    case 'app.error':
      break;
    case 'session.summary':
      sessionRecord = {
        ...sessionRecord,
        summary: event.summary,
      };
      break;
  }
}

function upsertCaption(captions: CaptionSegment[], caption: CaptionSegment): CaptionSegment[] {
  const withoutCurrent = captions.filter((item) => item.id !== caption.id);
  return [...withoutCurrent, caption].sort((left, right) => left.startMs - right.startMs);
}

function withSummary(record: SessionRecord): SessionRecord {
  if (record.summary || !record.sessionId || record.captions.length === 0) {
    return record;
  }

  return {
    ...record,
    summary: generateSessionSummary(record.sessionId, record.captions),
  };
}

function normalizeApiError(error: unknown) {
  if (error instanceof ApiRequestError) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      recoverable: error.recoverable,
    };
  }

  if (error instanceof EchoBridgeError) {
    return {
      status:
        error.code === 'SESSION_NOT_RUNNING' || error.code === 'SESSION_NOT_PAUSED' ? 409 : 500,
      code: error.code,
      message: error.message,
      recoverable: error.recoverable,
    };
  }

  return {
    status: 500,
    code: 'UNKNOWN' as const,
    message: error instanceof Error ? error.message : 'Unexpected API error.',
    recoverable: true,
  };
}

async function getAudioDiagnostics() {
  try {
    const devices = await audioSource.listOutputDevices();
    return {
      ready: devices.length > 0,
      deviceCount: devices.length,
      defaultDeviceLabel: devices.find((device) => device.isDefault)?.label,
      message:
        devices.length > 0
          ? 'Audio output capture is available.'
          : 'No active output devices found.',
    };
  } catch (error) {
    return {
      ready: false,
      deviceCount: 0,
      message: error instanceof Error ? error.message : 'Unable to inspect output devices.',
    };
  }
}

function getAiDiagnostics(env: NodeJS.ProcessEnv) {
  if (aiProviders.providerName === 'mock') {
    return {
      ready: true,
      provider: aiProviders.providerName,
      mode: aiProviders.providerMode,
      hasApiKey: false,
      message: 'Mock AI provider is active.',
    };
  }

  const hasApiKey = Boolean(env.OPENAI_API_KEY);
  return {
    ready: hasApiKey,
    provider: aiProviders.providerName,
    mode: aiProviders.providerMode,
    hasApiKey,
    transcriptionModel: env.ECHO_BRIDGE_TRANSCRIPTION_MODEL ?? 'gpt-4o-transcribe',
    translationModel: env.ECHO_BRIDGE_TRANSLATION_MODEL ?? 'gpt-4.1-mini',
    realtimeModel: env.ECHO_BRIDGE_REALTIME_MODEL ?? 'gpt-realtime',
    message: hasApiKey
      ? 'OpenAI provider is configured.'
      : 'OPENAI_API_KEY is required for OpenAI provider modes.',
  };
}
