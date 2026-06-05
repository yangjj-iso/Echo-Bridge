import OpenAI, { toFile } from 'openai';
import WebSocket from 'ws';

import type { AudioChunk, CaptionRevision, CaptionSegment, StartSessionRequest } from '@echo-bridge/shared';
import type { TranscriptEvent, TranscriptionProvider } from '@echo-bridge/transcription';
import { MockTranscriptionProvider } from '@echo-bridge/transcription';
import type { TranslationProvider, TranslationResult } from '@echo-bridge/translation';
import { MockTranslationProvider } from '@echo-bridge/translation';

export interface AiProviders {
  transcriptionProvider: TranscriptionProvider;
  translationProvider: TranslationProvider;
  providerName: 'mock' | 'openai';
}

export interface AiProviderConfig {
  provider?: string;
  apiKey?: string;
  openAiMode?: string;
  realtimeModel?: string;
  transcriptionModel?: string;
  translationModel?: string;
}

export function createAiProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): AiProviders {
  return createAiProviders({
    provider: env.ECHO_BRIDGE_AI_PROVIDER,
    apiKey: env.OPENAI_API_KEY,
    openAiMode: env.ECHO_BRIDGE_OPENAI_MODE,
    realtimeModel: env.ECHO_BRIDGE_REALTIME_MODEL,
    transcriptionModel: env.ECHO_BRIDGE_TRANSCRIPTION_MODEL,
    translationModel: env.ECHO_BRIDGE_TRANSLATION_MODEL,
  });
}

export function createAiProviders(config: AiProviderConfig): AiProviders {
  if (config.provider !== 'openai') {
    return {
      providerName: 'mock',
      transcriptionProvider: new MockTranscriptionProvider(),
      translationProvider: new MockTranslationProvider(),
    };
  }

  if (!config.apiKey) {
    throw new Error('OPENAI_API_KEY is required when ECHO_BRIDGE_AI_PROVIDER=openai.');
  }

  const client = new OpenAI({ apiKey: config.apiKey });
  const translationProvider = new OpenAiTranslationProvider({
    client,
    model: config.translationModel ?? 'gpt-4.1-mini',
  });

  if (config.openAiMode === 'realtime') {
    return {
      providerName: 'openai',
      transcriptionProvider: new OpenAiRealtimeTranslationProvider({
        apiKey: config.apiKey,
        model: config.realtimeModel ?? 'gpt-realtime',
      }),
      translationProvider,
    };
  }

  return {
    providerName: 'openai',
    transcriptionProvider: new OpenAiBufferedTranscriptionProvider({
      client,
      model: config.transcriptionModel ?? 'gpt-4o-transcribe',
    }),
    translationProvider,
  };
}

interface OpenAiProviderOptions {
  client: OpenAI;
  model: string;
}

export class OpenAiBufferedTranscriptionProvider implements TranscriptionProvider {
  readonly #client: OpenAI;
  readonly #model: string;
  readonly #chunks: Uint8Array[] = [];
  #lastStartMs = 0;
  #segmentIndex = 0;

  constructor(options: OpenAiProviderOptions) {
    this.#client = options.client;
    this.#model = options.model;
  }

  async acceptAudio(chunk: AudioChunk): Promise<TranscriptEvent[]> {
    this.#chunks.push(chunk.data);

    if (this.#chunks.length < 8) {
      return [];
    }

    const audio = concatBytes(this.#chunks.splice(0));
    const wav = pcm16ToWav(audio, chunk.format.sampleRate, chunk.format.channels);
    const transcription = await this.#client.audio.transcriptions.create({
      file: await toFile(Buffer.from(wav), `echo-bridge-${chunk.sequence}.wav`),
      model: this.#model,
    });
    const text = transcription.text.trim();

    if (!text) {
      return [];
    }

    this.#segmentIndex += 1;
    const startMs = this.#lastStartMs;
    const durationMs = Math.max(500, Math.round((audio.byteLength / 2 / chunk.format.channels / chunk.format.sampleRate) * 1000));
    this.#lastStartMs += durationMs;

    return [
      {
        id: `openai-transcript-${this.#segmentIndex}`,
        startMs,
        endMs: startMs + durationMs,
        text,
        isFinal: true,
      },
    ];
  }

  async close(): Promise<void> {
    this.#chunks.length = 0;
  }
}

interface OpenAiRealtimeTranslationOptions {
  apiKey: string;
  model: string;
  url?: string;
  connectTimeoutMs?: number;
}

type RealtimeTranslationEvent =
  | {
      type: 'session.updated';
    }
  | {
      type: 'conversation.item.input_audio_transcription.delta';
      item_id?: string;
      delta?: string;
    }
  | {
      type: 'conversation.item.input_audio_transcription.completed';
      item_id?: string;
      transcript?: string;
    }
  | {
      type:
        | 'response.audio_transcript.delta'
        | 'response.output_audio_transcript.delta'
        | 'response.output_transcript.delta'
        | 'response.output_text.delta'
        | 'response.text.delta';
      item_id?: string;
      delta?: string;
    }
  | {
      type:
        | 'response.audio_transcript.done'
        | 'response.output_audio_transcript.done'
        | 'response.output_transcript.done'
        | 'response.output_text.done'
        | 'response.text.done';
      item_id?: string;
      transcript?: string;
      text?: string;
    }
  | {
      type: 'error';
      error?: {
        message?: string;
      };
    }
  | {
      type: string;
      item_id?: string;
      delta?: string;
      transcript?: string;
      text?: string;
      error?: {
        message?: string;
      };
    };

interface RealtimeTranscriptDraft {
  id: string;
  startMs: number;
  sourceText: string;
  translatedText: string;
  emittedSourceLength: number;
  emittedTranslatedLength: number;
  final: boolean;
}

export class OpenAiRealtimeTranslationProvider implements TranscriptionProvider {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #url: string;
  readonly #connectTimeoutMs: number;
  readonly #pending: TranscriptEvent[] = [];
  readonly #drafts = new Map<string, RealtimeTranscriptDraft>();
  #socket?: WebSocket;
  #lastError?: Error;
  #segmentIndex = 0;
  #lastStartMs = 0;

  constructor(options: OpenAiRealtimeTranslationOptions) {
    this.#apiKey = options.apiKey;
    this.#model = options.model;
    this.#url = options.url ?? 'wss://api.openai.com/v1/realtime';
    this.#connectTimeoutMs = options.connectTimeoutMs ?? 10_000;
  }

  async start(request: StartSessionRequest): Promise<void> {
    this.#pending.length = 0;
    this.#drafts.clear();
    this.#lastError = undefined;
    this.#segmentIndex = 0;
    this.#lastStartMs = 0;
    this.#socket = await this.#connect();
    this.#send({
      type: 'session.update',
      session: {
        type: 'realtime',
        output_modalities: ['text'],
        audio: {
          input: {
            format: {
              type: 'audio/pcm',
              rate: 24000,
            },
            transcription: {
              model: 'gpt-4o-transcribe',
              language: request.sourceLanguage === 'auto' ? undefined : request.sourceLanguage,
            },
            turn_detection: {
              type: 'server_vad',
            },
          },
        },
        instructions:
          'Translate the incoming audio into concise Simplified Chinese subtitles. Keep each subtitle short enough for live captions.',
      },
    });
  }

  async acceptAudio(chunk: AudioChunk): Promise<TranscriptEvent[]> {
    this.#throwIfFailed();
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return this.#drainPending();
    }

    this.#send({
      type: 'input_audio_buffer.append',
      audio: Buffer.from(resamplePcm16Mono(chunk.data, chunk.format.sampleRate, 24000)).toString('base64'),
    });

    this.#throwIfFailed();
    return this.#drainPending();
  }

  async close(): Promise<TranscriptEvent[]> {
    const socket = this.#socket;
    if (socket && socket.readyState === WebSocket.OPEN) {
      this.#send({ type: 'input_audio_buffer.commit' });
      this.#send({ type: 'response.create' });
      await wait(750);
      socket.close();
    }

    this.#socket = undefined;
    this.#throwIfFailed();
    const events = [...this.#drainPending()];

    for (const draft of this.#drafts.values()) {
      if (!draft.final && (draft.sourceText || draft.translatedText)) {
        events.push(this.#toTranscriptEvent(draft, true));
      }
    }

    this.#drafts.clear();
    return events;
  }

  async #connect(): Promise<WebSocket> {
    const socket = new WebSocket(`${this.#url}?model=${encodeURIComponent(this.#model)}`, {
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
      },
    });

    socket.on('message', (data) => {
      try {
        this.#handleMessage(data.toString());
      } catch (error) {
        this.#lastError = error instanceof Error ? error : new Error(String(error));
      }
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('Timed out connecting to OpenAI realtime translation.'));
      }, this.#connectTimeoutMs);

      socket.once('open', () => {
        clearTimeout(timer);
        resolve(socket);
      });

      socket.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  #handleMessage(raw: string): void {
    const event = JSON.parse(raw) as RealtimeTranslationEvent;

    if (event.type === 'error') {
      this.#lastError = new Error(event.error?.message ?? 'OpenAI realtime translation error.');
      return;
    }

    if (isSourceTranscriptEvent(event)) {
      const draft = this.#draftFor(event.item_id);
      if ('delta' in event && event.delta) {
        draft.sourceText += event.delta;
      }
      if ('transcript' in event && event.transcript) {
        draft.sourceText = event.transcript;
      }
      this.#queueIfChanged(draft, event.type.endsWith('.completed'));
      return;
    }

    if (isTranslatedTranscriptEvent(event)) {
      const draft = this.#draftFor(event.item_id);
      if ('delta' in event && event.delta) {
        draft.translatedText += event.delta;
      }
      if ('transcript' in event && event.transcript) {
        draft.translatedText = event.transcript;
      }
      if ('text' in event && event.text) {
        draft.translatedText = event.text;
      }
      this.#queueIfChanged(draft, event.type.endsWith('.done'));
    }
  }

  #draftFor(itemId?: string): RealtimeTranscriptDraft {
    const key = itemId ?? `realtime-${this.#segmentIndex + 1}`;
    const current = this.#drafts.get(key);
    if (current) {
      return current;
    }

    this.#segmentIndex += 1;
    const draft: RealtimeTranscriptDraft = {
      id: `realtime-transcript-${this.#segmentIndex}`,
      startMs: this.#lastStartMs,
      sourceText: '',
      translatedText: '',
      emittedSourceLength: 0,
      emittedTranslatedLength: 0,
      final: false,
    };
    this.#lastStartMs += 2_000;
    this.#drafts.set(key, draft);
    return draft;
  }

  #queueIfChanged(draft: RealtimeTranscriptDraft, final: boolean): void {
    if (
      draft.sourceText.length === draft.emittedSourceLength &&
      draft.translatedText.length === draft.emittedTranslatedLength &&
      draft.final === final
    ) {
      return;
    }

    draft.emittedSourceLength = draft.sourceText.length;
    draft.emittedTranslatedLength = draft.translatedText.length;
    draft.final = final || draft.final;
    this.#pending.push(this.#toTranscriptEvent(draft, draft.final));
  }

  #toTranscriptEvent(draft: RealtimeTranscriptDraft, isFinal: boolean): TranscriptEvent {
    return {
      id: draft.id,
      startMs: draft.startMs,
      endMs: isFinal ? draft.startMs + 1_800 : undefined,
      text: draft.sourceText.trim() || 'Audio segment',
      translatedText: draft.translatedText.trim() || undefined,
      isFinal,
    };
  }

  #drainPending(): TranscriptEvent[] {
    return this.#pending.splice(0);
  }

  #send(payload: unknown): void {
    this.#socket?.send(JSON.stringify(payload));
  }

  #throwIfFailed(): void {
    if (this.#lastError) {
      throw this.#lastError;
    }
  }
}

export class OpenAiTranslationProvider implements TranslationProvider {
  readonly #client: OpenAI;
  readonly #model: string;

  constructor(options: OpenAiProviderOptions) {
    this.#client = options.client;
    this.#model = options.model;
  }

  async translateSegment(
    segment: CaptionSegment,
    context: CaptionSegment[],
  ): Promise<TranslationResult> {
    const response = await this.#client.responses.create({
      model: this.#model,
      input: [
        {
          role: 'system',
          content:
            'You translate live English transcripts into concise Simplified Chinese subtitles. Return strict JSON.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            current: {
              id: segment.id,
              sourceText: segment.sourceText,
            },
            recentContext: context.slice(-6).map((caption) => ({
              id: caption.id,
              sourceText: caption.sourceText,
              translatedText: caption.translatedText,
              revision: caption.revision,
            })),
            schema: {
              translatedText: 'string',
              revisions: [
                {
                  captionId: 'string',
                  revision: 'number',
                  sourceText: 'string optional',
                  translatedText: 'string optional',
                  reason: 'string',
                },
              ],
            },
          }),
        },
      ],
      text: {
        format: {
          type: 'json_object',
        },
      },
    });

    return parseTranslationResult(response.output_text);
  }
}

function parseTranslationResult(value: string): TranslationResult {
  const parsed = JSON.parse(value) as Partial<TranslationResult>;
  return {
    translatedText: String(parsed.translatedText ?? ''),
    revisions: Array.isArray(parsed.revisions)
      ? parsed.revisions.filter(isCaptionRevision)
      : [],
  };
}

function isCaptionRevision(value: unknown): value is CaptionRevision {
  const candidate = value as Partial<CaptionRevision>;
  return (
    typeof candidate.captionId === 'string' &&
    typeof candidate.revision === 'number' &&
    typeof candidate.reason === 'string'
  );
}

type SourceTranscriptEvent = Extract<
  RealtimeTranslationEvent,
  {
    type:
      | 'conversation.item.input_audio_transcription.delta'
      | 'conversation.item.input_audio_transcription.completed';
  }
>;

type TranslatedTranscriptEvent = Extract<
  RealtimeTranslationEvent,
  {
    type:
      | 'response.audio_transcript.delta'
      | 'response.output_audio_transcript.delta'
      | 'response.output_transcript.delta'
      | 'response.output_text.delta'
      | 'response.text.delta'
      | 'response.audio_transcript.done'
      | 'response.output_audio_transcript.done'
      | 'response.output_transcript.done'
      | 'response.output_text.done'
      | 'response.text.done';
  }
>;

function isSourceTranscriptEvent(event: RealtimeTranslationEvent): event is SourceTranscriptEvent {
  return (
    event.type === 'conversation.item.input_audio_transcription.delta' ||
    event.type === 'conversation.item.input_audio_transcription.completed'
  );
}

function isTranslatedTranscriptEvent(event: RealtimeTranslationEvent): event is TranslatedTranscriptEvent {
  return (
    event.type === 'response.audio_transcript.delta' ||
    event.type === 'response.output_audio_transcript.delta' ||
    event.type === 'response.output_transcript.delta' ||
    event.type === 'response.output_text.delta' ||
    event.type === 'response.text.delta' ||
    event.type === 'response.audio_transcript.done' ||
    event.type === 'response.output_audio_transcript.done' ||
    event.type === 'response.output_transcript.done' ||
    event.type === 'response.output_text.done' ||
    event.type === 'response.text.done'
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resamplePcm16Mono(pcm: Uint8Array, sourceSampleRate: number, targetSampleRate: number): Uint8Array {
  if (sourceSampleRate === targetSampleRate) {
    return pcm;
  }

  const sourceSamples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const ratio = sourceSampleRate / targetSampleRate;
  const outputSampleCount = Math.max(1, Math.round(sourceSamples.length / ratio));
  const output = new Int16Array(outputSampleCount);

  for (let index = 0; index < outputSampleCount; index += 1) {
    const sourceIndex = Math.min(sourceSamples.length - 1, Math.round(index * ratio));
    output[index] = sourceSamples[sourceIndex] ?? 0;
  }

  return new Uint8Array(output.buffer);
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

function pcm16ToWav(pcm: Uint8Array, sampleRate: number, channels: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const byteRate = sampleRate * channels * 2;

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, pcm.byteLength, true);

  const wav = new Uint8Array(44 + pcm.byteLength);
  wav.set(new Uint8Array(header), 0);
  wav.set(pcm, 44);
  return wav;
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
