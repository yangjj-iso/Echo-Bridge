import { describe, expect, it, vi } from 'vitest';

import type { AudioCaptureSource } from '@echo-bridge/audio';
import { MockAudioCaptureSource } from '@echo-bridge/audio';
import { EchoBridgeError, type AppEvent } from '@echo-bridge/shared';
import { MockTranscriptionProvider, type TranscriptionProvider } from '@echo-bridge/transcription';
import { MockTranslationProvider, type TranslationProvider } from '@echo-bridge/translation';

import { InterpretationPipeline } from './index.js';

describe('InterpretationPipeline', () => {
  it('emits translated captions and contextual revisions from audio chunks', async () => {
    vi.useFakeTimers();
    const events: AppEvent[] = [];
    const pipeline = new InterpretationPipeline({
      audioSource: new MockAudioCaptureSource(),
      transcriptionProvider: new MockTranscriptionProvider(),
      translationProvider: new MockTranslationProvider(),
    });

    await pipeline.start(
      {
        deviceId: 'default-output',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        latencyMode: 'balanced',
      },
      (event) => events.push(event),
    );

    await vi.advanceTimersByTimeAsync(4_000);
    const captions = await pipeline.stop((event) => events.push(event));
    vi.useRealTimers();

    expect(captions).toHaveLength(2);
    expect(events.map((event) => event.type)).toContain('caption.revised');
    expect(
      events.find(
        (event): event is Extract<AppEvent, { type: 'caption.upserted' }> =>
          event.type === 'caption.upserted' && event.caption.status === 'revised',
      )?.caption.translatedText,
    ).toBe('欢迎来到今天的技术分享。');
  });

  it('stops an existing session before starting a new one', async () => {
    vi.useFakeTimers();
    const events: AppEvent[] = [];
    const pipeline = new InterpretationPipeline({
      audioSource: new MockAudioCaptureSource(),
      transcriptionProvider: new MockTranscriptionProvider(),
      translationProvider: new MockTranslationProvider(),
    });

    const first = await pipeline.start(
      {
        deviceId: 'default-output',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        latencyMode: 'balanced',
      },
      (event) => events.push(event),
    );
    const second = await pipeline.start(
      {
        deviceId: 'virtual-meeting-output',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        latencyMode: 'balanced',
      },
      (event) => events.push(event),
    );

    await pipeline.stop();
    vi.useRealTimers();

    expect(first.sessionId).not.toBe(second.sessionId);
    expect(events.filter((event) => event.type === 'session.status')).toEqual([
      { type: 'session.status', status: 'starting' },
      { type: 'session.status', status: 'listening' },
      { type: 'session.status', status: 'stopping' },
      { type: 'session.status', status: 'idle' },
      { type: 'session.status', status: 'starting' },
      { type: 'session.status', status: 'listening' },
    ]);
  });

  it('resets captions between completed sessions', async () => {
    vi.useFakeTimers();
    const pipeline = new InterpretationPipeline({
      audioSource: new MockAudioCaptureSource(),
      transcriptionProvider: new MockTranscriptionProvider(),
      translationProvider: new MockTranslationProvider(),
    });

    await pipeline.start(
      {
        deviceId: 'default-output',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        latencyMode: 'balanced',
      },
      vi.fn(),
    );
    await vi.advanceTimersByTimeAsync(4_000);
    const firstSession = await pipeline.stop();

    await pipeline.start(
      {
        deviceId: 'default-output',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        latencyMode: 'balanced',
      },
      vi.fn(),
    );
    await vi.advanceTimersByTimeAsync(4_000);
    const secondSession = await pipeline.stop();
    vi.useRealTimers();

    expect(firstSession).toHaveLength(2);
    expect(secondSession).toHaveLength(2);
    expect(secondSession.map((caption) => caption.id)).toEqual(['transcript-1', 'transcript-2']);
  });

  it('uses translated transcript events without a second translation request', async () => {
    vi.useFakeTimers();
    const translateSegment = vi.fn<TranslationProvider['translateSegment']>();
    const pipeline = new InterpretationPipeline({
      audioSource: new MockAudioCaptureSource(),
      transcriptionProvider: new TranslatedMockTranscriptionProvider(),
      translationProvider: {
        translateSegment,
      },
    });

    await pipeline.start(
      {
        deviceId: 'default-output',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        latencyMode: 'balanced',
      },
      vi.fn(),
    );
    await vi.advanceTimersByTimeAsync(500);
    const captions = await pipeline.stop();
    vi.useRealTimers();

    expect(captions).toHaveLength(1);
    expect(captions[0]?.translatedText).toBe('已经翻译好的实时字幕。');
    expect(translateSegment).not.toHaveBeenCalled();
  });

  it('pauses chunk processing and resumes the active capture session', async () => {
    vi.useFakeTimers();
    const events: AppEvent[] = [];
    const pipeline = new InterpretationPipeline({
      audioSource: new MockAudioCaptureSource(),
      transcriptionProvider: new MockTranscriptionProvider(),
      translationProvider: new MockTranslationProvider(),
    });

    await pipeline.start(
      {
        deviceId: 'default-output',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        latencyMode: 'balanced',
      },
      (event) => events.push(event),
    );

    await vi.advanceTimersByTimeAsync(1_500);
    pipeline.pause((event) => events.push(event));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(events.filter((event) => event.type === 'caption.upserted')).toHaveLength(0);

    pipeline.resume((event) => events.push(event));
    await vi.advanceTimersByTimeAsync(2_500);
    const captions = await pipeline.stop((event) => events.push(event));
    vi.useRealTimers();

    expect(captions.length).toBeGreaterThan(0);
    expect(events.filter((event) => event.type === 'session.status')).toEqual([
      { type: 'session.status', status: 'starting' },
      { type: 'session.status', status: 'listening' },
      { type: 'session.status', status: 'paused' },
      { type: 'session.status', status: 'listening' },
      { type: 'session.status', status: 'stopping' },
      { type: 'session.status', status: 'idle' },
    ]);
  });

  it('rejects resume when the active session is not paused', async () => {
    const pipeline = new InterpretationPipeline({
      audioSource: new MockAudioCaptureSource(),
      transcriptionProvider: new MockTranscriptionProvider(),
      translationProvider: new MockTranslationProvider(),
    });

    await pipeline.start(
      {
        deviceId: 'default-output',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
        latencyMode: 'balanced',
      },
      vi.fn(),
    );

    expect(() => pipeline.resume()).toThrow(
      expect.objectContaining({
        code: 'SESSION_NOT_PAUSED',
      }),
    );

    await pipeline.stop();
  });

  it('closes a started transcription provider when audio capture fails to start', async () => {
    const start = vi.fn<TranscriptionProvider['start']>();
    const close = vi.fn<TranscriptionProvider['close']>();
    const events: AppEvent[] = [];
    const pipeline = new InterpretationPipeline({
      audioSource: new FailingAudioCaptureSource(),
      transcriptionProvider: {
        start,
        acceptAudio: vi.fn(),
        close,
      },
      translationProvider: new MockTranslationProvider(),
    });

    await expect(
      pipeline.start(
        {
          deviceId: 'default-output',
          sourceLanguage: 'en',
          targetLanguage: 'zh-CN',
          latencyMode: 'balanced',
        },
        (event) => events.push(event),
      ),
    ).rejects.toMatchObject({ code: 'AUDIO_CAPTURE_FAILED' });

    expect(start).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(events.filter((event) => event.type === 'session.status')).toEqual([
      { type: 'session.status', status: 'starting' },
      { type: 'session.status', status: 'idle' },
    ]);
  });
});

class TranslatedMockTranscriptionProvider implements TranscriptionProvider {
  async acceptAudio() {
    return [
      {
        id: 'translated-transcript-1',
        startMs: 0,
        endMs: 900,
        text: 'A realtime translated caption.',
        translatedText: '已经翻译好的实时字幕。',
        isFinal: true,
      },
    ];
  }

  async close() {
    return [];
  }
}

class FailingAudioCaptureSource implements AudioCaptureSource {
  async listOutputDevices() {
    return [];
  }

  async start() {
    throw new EchoBridgeError({
      code: 'AUDIO_CAPTURE_FAILED',
      message: 'Failed to open output device.',
      recoverable: true,
    });
  }
}
