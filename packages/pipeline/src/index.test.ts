import { describe, expect, it, vi } from 'vitest';

import { MockAudioCaptureSource } from '@echo-bridge/audio';
import type { AppEvent } from '@echo-bridge/shared';
import { MockTranscriptionProvider } from '@echo-bridge/transcription';
import { MockTranslationProvider } from '@echo-bridge/translation';

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
});
