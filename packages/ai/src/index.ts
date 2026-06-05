import OpenAI, { toFile } from 'openai';

import type { AudioChunk, CaptionRevision, CaptionSegment } from '@echo-bridge/shared';
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
  transcriptionModel?: string;
  translationModel?: string;
}

export function createAiProvidersFromEnv(env: NodeJS.ProcessEnv = process.env): AiProviders {
  return createAiProviders({
    provider: env.ECHO_BRIDGE_AI_PROVIDER,
    apiKey: env.OPENAI_API_KEY,
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

  return {
    providerName: 'openai',
    transcriptionProvider: new OpenAiBufferedTranscriptionProvider({
      client,
      model: config.transcriptionModel ?? 'gpt-4o-transcribe',
    }),
    translationProvider: new OpenAiTranslationProvider({
      client,
      model: config.translationModel ?? 'gpt-4.1-mini',
    }),
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
