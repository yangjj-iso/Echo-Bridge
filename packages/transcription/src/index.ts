import type { AudioChunk, StartSessionRequest } from '@echo-bridge/shared';

export interface TranscriptEvent {
  id: string;
  startMs: number;
  endMs?: number;
  text: string;
  translatedText?: string;
  confidence?: number;
  isFinal: boolean;
}

export interface TranscriptionProvider {
  start?(request: StartSessionRequest): Promise<void>;
  acceptAudio(chunk: AudioChunk): Promise<TranscriptEvent[]>;
  close(): Promise<TranscriptEvent[] | void>;
}

export class MockTranscriptionProvider implements TranscriptionProvider {
  readonly #script: readonly [string, ...string[]] = [
    'Welcome to today technical session.',
    'We will discuss realtime translation architecture.',
    'The system can revise previous captions when context changes.',
  ];

  async acceptAudio(chunk: AudioChunk): Promise<TranscriptEvent[]> {
    if (chunk.sequence % 4 !== 0) {
      return [];
    }

    const index = Math.floor(chunk.sequence / 4) - 1;
    const text = this.#script[index % this.#script.length] ?? this.#script[0];
    const startMs = index * 2000;

    return [
      {
        id: `transcript-${index + 1}`,
        startMs,
        endMs: startMs + 1800,
        text,
        confidence: 0.9,
        isFinal: true,
      },
    ];
  }

  async close(): Promise<void> {
    return Promise.resolve();
  }
}
