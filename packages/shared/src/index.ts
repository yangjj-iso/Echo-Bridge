export type LanguageCode = 'en' | 'zh-CN' | 'auto';
export type TargetLanguageCode = Exclude<LanguageCode, 'auto'>;

export type SessionStatus = 'idle' | 'starting' | 'listening' | 'paused' | 'stopping' | 'error';

export type CaptionStatus = 'partial' | 'final' | 'revised';

export interface AudioDevice {
  id: string;
  label: string;
  kind: 'output';
  isDefault: boolean;
}

export interface AudioFormat {
  sampleRate: number;
  channels: number;
  encoding: 'pcm_s16le' | 'pcm_f32le';
}

export interface AudioChunk {
  sessionId: string;
  sequence: number;
  timestampMs: number;
  data: Uint8Array;
  format: AudioFormat;
}

export interface CaptionSegment {
  id: string;
  startMs: number;
  endMs?: number;
  sourceText: string;
  translatedText?: string;
  status: CaptionStatus;
  confidence?: number;
  revision: number;
  revisedFromId?: string;
}

export interface CaptionRevision {
  captionId: string;
  revision: number;
  sourceText?: string;
  translatedText?: string;
  reason: string;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  summary: string;
  keywords: string[];
  takeaways: string[];
}

export interface SessionRecord {
  sessionId?: string;
  startedAt?: string;
  endedAt?: string;
  status: SessionStatus;
  captions: CaptionSegment[];
  summary?: SessionSummary;
}

export interface SessionHistoryItem {
  sessionId: string;
  startedAt?: string;
  endedAt?: string;
  captionCount: number;
  durationMs: number;
  revisedCount: number;
  title?: string;
}

export type AppErrorCode =
  | 'AUDIO_DEVICE_NOT_FOUND'
  | 'AUDIO_CAPTURE_FAILED'
  | 'INVALID_REQUEST'
  | 'TRANSCRIPTION_FAILED'
  | 'TRANSLATION_FAILED'
  | 'SESSION_NOT_RUNNING'
  | 'SESSION_NOT_PAUSED'
  | 'UNKNOWN';

export interface AppError {
  code: AppErrorCode;
  message: string;
  recoverable: boolean;
  cause?: string;
}

export class EchoBridgeError extends Error implements AppError {
  readonly code: AppErrorCode;
  readonly recoverable: boolean;
  override readonly cause?: string;

  constructor(error: AppError) {
    super(error.message);
    this.name = 'EchoBridgeError';
    this.code = error.code;
    this.recoverable = error.recoverable;
    this.cause = error.cause;
  }
}

export type AppEvent =
  | { type: 'devices.updated'; devices: AudioDevice[] }
  | { type: 'session.status'; status: SessionStatus }
  | { type: 'caption.upserted'; caption: CaptionSegment }
  | { type: 'caption.revised'; revision: CaptionRevision }
  | { type: 'session.summary'; summary: SessionSummary }
  | { type: 'app.error'; error: AppError };

export interface StartSessionRequest {
  deviceId: string;
  sourceLanguage: LanguageCode;
  targetLanguage: TargetLanguageCode;
  latencyMode: 'low' | 'balanced' | 'accurate';
}
