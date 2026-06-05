import type {
  AppErrorCode,
  LanguageCode,
  StartSessionRequest,
  TargetLanguageCode,
} from '@echo-bridge/shared';

export class ApiRequestError extends Error {
  readonly status = 400;
  readonly code: AppErrorCode = 'INVALID_REQUEST';
  readonly recoverable = true;

  constructor(message: string) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

export function parseStartSessionRequest(value: unknown): StartSessionRequest {
  const body = value as Partial<StartSessionRequest>;

  if (!isNonEmptyString(body.deviceId)) {
    throw new ApiRequestError('deviceId is required.');
  }

  if (!isLanguageCode(body.sourceLanguage)) {
    throw new ApiRequestError('sourceLanguage must be one of: auto, en, zh-CN.');
  }

  if (!isTargetLanguageCode(body.targetLanguage)) {
    throw new ApiRequestError('targetLanguage must be one of: en, zh-CN.');
  }

  if (!isLatencyMode(body.latencyMode)) {
    throw new ApiRequestError('latencyMode must be one of: low, balanced, accurate.');
  }

  return {
    deviceId: body.deviceId,
    sourceLanguage: body.sourceLanguage,
    targetLanguage: body.targetLanguage,
    latencyMode: body.latencyMode,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isLanguageCode(value: unknown): value is LanguageCode {
  return value === 'auto' || value === 'en' || value === 'zh-CN';
}

function isTargetLanguageCode(value: unknown): value is TargetLanguageCode {
  return value === 'en' || value === 'zh-CN';
}

function isLatencyMode(value: unknown): value is StartSessionRequest['latencyMode'] {
  return value === 'low' || value === 'balanced' || value === 'accurate';
}
