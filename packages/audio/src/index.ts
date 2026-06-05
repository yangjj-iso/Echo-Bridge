import { EchoBridgeError, type AudioChunk, type AudioDevice, type AudioFormat } from '@echo-bridge/shared';

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
  readonly #devices: AudioDevice[];

  constructor(devices: AudioDevice[] = createDefaultMockDevices()) {
    this.#devices = devices;
  }

  async listOutputDevices(): Promise<AudioDevice[]> {
    return this.#devices.map((device) => ({ ...device }));
  }

  async start(deviceId: string, onChunk: (chunk: AudioChunk) => void): Promise<AudioCaptureSession> {
    const devices = await this.listOutputDevices();
    const device = devices.find((item) => item.id === deviceId);

    if (!device) {
      throw new EchoBridgeError({
        code: 'AUDIO_DEVICE_NOT_FOUND',
        message: `Output device not found: ${deviceId}`,
        recoverable: true,
      });
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

    let stopped = false;

    return {
      id: sessionId,
      deviceId,
      format,
      async stop() {
        if (stopped) {
          return;
        }

        stopped = true;
        clearInterval(timer);
      },
    };
  }
}

export function createDefaultMockDevices(): AudioDevice[] {
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
