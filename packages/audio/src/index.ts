import type { AudioChunk, AudioDevice, AudioFormat } from '@echo-bridge/shared';

export interface AudioCaptureSource {
  listOutputDevices(): Promise<AudioDevice[]>;
  start(deviceId: string, onChunk: (chunk: AudioChunk) => void): Promise<AudioCaptureSession>;
}

export interface AudioCaptureSession {
  readonly id: string;
  readonly deviceId: string;
  readonly format: AudioFormat;
  stop(): Promise<void>;
}

export class MockAudioCaptureSource implements AudioCaptureSource {
  async listOutputDevices(): Promise<AudioDevice[]> {
    return [
      {
        id: 'default-output',
        label: 'Default system output',
        kind: 'output',
        isDefault: true,
      },
      {
        id: 'virtual-meeting-output',
        label: 'Virtual meeting output',
        kind: 'output',
        isDefault: false,
      },
    ];
  }

  async start(deviceId: string, onChunk: (chunk: AudioChunk) => void): Promise<AudioCaptureSession> {
    const devices = await this.listOutputDevices();
    const device = devices.find((item) => item.id === deviceId);

    if (!device) {
      throw new Error(`Output device not found: ${deviceId}`);
    }

    const format: AudioFormat = {
      sampleRate: 16000,
      channels: 1,
      encoding: 'pcm_s16le',
    };
    const sessionId = crypto.randomUUID();
    let sequence = 0;

    const timer = setInterval(() => {
      sequence += 1;
      onChunk({
        sessionId,
        sequence,
        timestampMs: Date.now(),
        data: new Uint8Array(320),
        format,
      });
    }, 500);

    return {
      id: sessionId,
      deviceId,
      format,
      async stop() {
        clearInterval(timer);
      },
    };
  }
}
