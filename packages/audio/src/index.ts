import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EchoBridgeError, type AudioChunk, type AudioDevice, type AudioFormat } from '@echo-bridge/shared';

export interface AudioCaptureSource {
  listOutputDevices(): Promise<AudioDevice[]>;
  start(
    deviceId: string,
    onChunk: (chunk: AudioChunk) => void,
    onError?: (error: EchoBridgeError) => void,
  ): Promise<AudioCaptureSession>;
}

export interface AudioCaptureSession {
  readonly id: string;
  readonly deviceId: string;
  readonly format: AudioFormat;
  stop(): Promise<void>;
}

type HelperLine =
  | {
      type: 'device';
      id: string;
      label: string;
      kind: 'output';
      isDefault: boolean;
    }
  | {
      type: 'started';
      sampleRate: number;
      channels: number;
      encoding: 'pcm_s16le';
    }
  | {
      type: 'chunk';
      sequence: number;
      timestampMs: number;
      sampleRate: number;
      channels: number;
      encoding: 'pcm_s16le';
      data: string;
    }
  | {
      type: 'error';
      code: string;
      message: string;
    };

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
    const sessionId = randomUUID();
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

export class WindowsAudioCaptureSource implements AudioCaptureSource {
  readonly #projectPath: string;

  constructor(projectPath = resolveHelperProjectPath()) {
    this.#projectPath = projectPath;
  }

  async listOutputDevices(): Promise<AudioDevice[]> {
    const lines = await runHelperCommand(this.#projectPath, ['list-devices']);
    return lines
      .filter((line): line is Extract<HelperLine, { type: 'device' }> => line.type === 'device')
      .map((line) => ({
        id: line.id,
        label: line.label,
        kind: 'output',
        isDefault: line.isDefault,
      }));
  }

  async start(
    deviceId: string,
    onChunk: (chunk: AudioChunk) => void,
    onError?: (error: EchoBridgeError) => void,
  ): Promise<AudioCaptureSession> {
    const devices = await this.listOutputDevices();
    const device = devices.find((item) => item.id === deviceId);

    if (!device) {
      throw new EchoBridgeError({
        code: 'AUDIO_DEVICE_NOT_FOUND',
        message: `Output device not found: ${deviceId}`,
        recoverable: true,
      });
    }

    const sessionId = randomUUID();
    const child = spawn(
      'dotnet',
      ['run', '--project', this.#projectPath, '--', 'capture', '--deviceId', deviceId],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );

    let stopped = false;
    let startupSettled = false;
    let startupResolve!: () => void;
    let startupReject!: (error: EchoBridgeError) => void;
    let stderr = '';
    let format: AudioFormat = {
      sampleRate: 16000,
      channels: 1,
      encoding: 'pcm_s16le',
    };
    const startup = new Promise<void>((resolve, reject) => {
      startupResolve = resolve;
      startupReject = reject;
    });
    const exitPromise = onceExit(child);
    const fail = (error: EchoBridgeError) => {
      if (!startupSettled) {
        startupSettled = true;
        child.kill();
        startupReject(error);
        return;
      }

      if (!stopped) {
        onError?.(error);
      }
    };

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.once('error', (error) => {
      fail(
        new EchoBridgeError({
          code: 'AUDIO_CAPTURE_FAILED',
          message: 'Failed to start Windows audio helper.',
          recoverable: true,
          cause: error.message,
        }),
      );
    });

    void exitPromise.then(({ code, signal }) => {
      if (stopped) {
        return;
      }

      fail(
        new EchoBridgeError({
          code: 'AUDIO_CAPTURE_FAILED',
          message: stderr.trim() || `Windows audio helper exited unexpectedly (${formatExit(code, signal)}).`,
          recoverable: true,
        }),
      );
    });

    observeNdjson(
      child,
      (line) => {
        if (line.type === 'started') {
          format = {
            sampleRate: line.sampleRate,
            channels: line.channels,
            encoding: line.encoding,
          };
          startupSettled = true;
          startupResolve();
          return;
        }

        if (line.type === 'chunk') {
          onChunk({
            sessionId,
            sequence: line.sequence,
            timestampMs: line.timestampMs,
            data: Uint8Array.from(Buffer.from(line.data, 'base64')),
            format,
          });
          return;
        }

        if (line.type === 'error') {
          fail(
            new EchoBridgeError({
              code: 'AUDIO_CAPTURE_FAILED',
              message: line.message,
              recoverable: true,
              cause: line.code,
            }),
          );
        }
      },
      (part, error) => {
        fail(createInvalidHelperOutputError(part, error));
      },
    );

    await startup;

    return {
      id: sessionId,
      deviceId,
      get format() {
        return format;
      },
      async stop() {
        if (stopped) {
          return;
        }

        stopped = true;
        child.kill('SIGTERM');
        await exitPromise;
      },
    };
  }
}

export function createAudioCaptureSource(platform = process.platform): AudioCaptureSource {
  if (platform === 'win32') {
    return new WindowsAudioCaptureSource();
  }

  return new MockAudioCaptureSource();
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

async function runHelperCommand(projectPath: string, args: string[]): Promise<HelperLine[]> {
  const child = spawn('dotnet', ['run', '--project', projectPath, '--', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const lines: HelperLine[] = [];
  let stderr = '';

  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  let parseError: EchoBridgeError | undefined;
  observeNdjson(
    child,
    (line) => {
      lines.push(line);
    },
    (part, error) => {
      parseError = createInvalidHelperOutputError(part, error);
      child.kill();
    },
  );

  const exit = await onceExit(child);

  const errorLine = lines.find((line): line is Extract<HelperLine, { type: 'error' }> => line.type === 'error');
  if (errorLine) {
    throw new EchoBridgeError({
      code: 'AUDIO_CAPTURE_FAILED',
      message: errorLine.message,
      recoverable: true,
      cause: errorLine.code,
    });
  }

  if (parseError) {
    throw parseError;
  }

  if (exit.code !== 0) {
    throw new EchoBridgeError({
      code: 'AUDIO_CAPTURE_FAILED',
      message: stderr.trim() || `Windows audio helper failed (${formatExit(exit.code, exit.signal)}).`,
      recoverable: true,
    });
  }

  return lines;
}

function observeNdjson(
  child: ChildProcessByStdio<null, Readable, Readable>,
  onLine: (line: HelperLine) => void,
  onInvalidLine: (line: string, error: unknown) => void,
): void {
  let buffer = '';

  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const parts = buffer.split(/\r?\n/);
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      if (!part.trim()) {
        continue;
      }

      try {
        onLine(JSON.parse(part) as HelperLine);
      } catch (error) {
        onInvalidLine(part, error);
      }
    }
  });
}

function onceExit(
  child: ChildProcessByStdio<null, Readable, Readable>,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child.once('exit', (code: number | null, signal: NodeJS.Signals | null) => resolve({ code, signal }));
  });
}

function resolveHelperProjectPath(): string {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDirectory, '../../../native/windows-audio-helper/windows-audio-helper.csproj');
}

function createInvalidHelperOutputError(line: string, error: unknown): EchoBridgeError {
  return new EchoBridgeError({
    code: 'AUDIO_CAPTURE_FAILED',
    message: `Windows audio helper returned invalid output: ${line}`,
    recoverable: true,
    cause: error instanceof Error ? error.message : String(error),
  });
}

function formatExit(code: number | null, signal: NodeJS.Signals | null): string {
  return `code=${code ?? 'null'}, signal=${signal ?? 'null'}`;
}
