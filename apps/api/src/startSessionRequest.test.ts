import { describe, expect, it } from 'vitest';

import { ApiRequestError, parseStartSessionRequest } from './startSessionRequest.js';

const validRequest = {
  deviceId: 'default-device',
  sourceLanguage: 'auto',
  targetLanguage: 'zh-CN',
  latencyMode: 'balanced',
};

describe('parseStartSessionRequest', () => {
  it('returns a typed start request for valid input', () => {
    expect(parseStartSessionRequest(validRequest)).toEqual(validRequest);
  });

  it('rejects target language auto because targets must be explicit', () => {
    expect(() =>
      parseStartSessionRequest({
        ...validRequest,
        targetLanguage: 'auto',
      }),
    ).toThrow(ApiRequestError);
  });

  it('returns invalid request metadata for malformed fields', () => {
    try {
      parseStartSessionRequest({
        ...validRequest,
        latencyMode: 'fast',
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ApiRequestError);
      expect(error).toMatchObject({
        status: 400,
        code: 'INVALID_REQUEST',
        message: 'latencyMode must be one of: low, balanced, accurate.',
        recoverable: true,
      });
      return;
    }

    throw new Error('Expected request parsing to fail.');
  });
});
