export type LanguageCode = 'en' | 'zh-CN' | 'auto';

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

export type AppErrorCode =
  | 'AUDIO_DEVICE_NOT_FOUND'
  | 'AUDIO_CAPTURE_FAILED'
  | 'TRANSCRIPTION_FAILED'
  | 'TRANSLATION_FAILED'
  | 'SESSION_NOT_RUNNING'
  | 'UNKNOWN';

export interface AppError {
  code: AppErrorCode;
  message: string;
  recoverable: boolean;
  cause?: string;
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
  targetLanguage: LanguageCode;
  latencyMode: 'low' | 'balanced' | 'accurate';
}
