import { describe, expect, it, vi } from 'vitest';

import { EchoBridgeError } from '@echo-bridge/shared';

import { MockAudioCaptureSource, WindowsAudioCaptureSource, createAudioCaptureSource } from './index.js';

describe('MockAudioCaptureSource', () => {
  it('returns defensive copies of output devices', async () => {
    const source = new MockAudioCaptureSource();

    const first = await source.listOutputDevices();
    first[0]!.label = 'Mutated';

    const second = await source.listOutputDevices();

    expect(second[0]?.label).toBe('Default system output');
  });

  it('throws a typed recoverable error for unknown devices', async () => {
    const source = new MockAudioCaptureSource();

    await expect(source.start('missing-device', vi.fn())).rejects.toMatchObject({
      code: 'AUDIO_DEVICE_NOT_FOUND',
      recoverable: true,
    } satisfies Partial<EchoBridgeError>);
  });

  it('emits PCM chunks and supports idempotent stop', async () => {
    vi.useFakeTimers();
    const onChunk = vi.fn();
    const source = new MockAudioCaptureSource();

    const session = await source.start('default-output', onChunk);
    vi.advanceTimersByTime(1000);

    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onChunk.mock.calls[0]?.[0]).toMatchObject({
      sequence: 1,
      format: {
        sampleRate: 16000,
        channels: 1,
        encoding: 'pcm_s16le',
      },
    });

    await session.stop();
    await session.stop();
    vi.advanceTimersByTime(1000);

    expect(onChunk).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('uses the Windows helper source on win32', () => {
    expect(createAudioCaptureSource('win32')).toBeInstanceOf(WindowsAudioCaptureSource);
    expect(createAudioCaptureSource('linux')).toBeInstanceOf(MockAudioCaptureSource);
  });
});
