import { describe, expect, it } from 'vitest';

import { createAiProviders } from './index.js';

describe('createAiProviders', () => {
  it('uses mock providers by default', () => {
    expect(createAiProviders({}).providerName).toBe('mock');
  });

  it('requires an API key for OpenAI providers', () => {
    expect(() => createAiProviders({ provider: 'openai' })).toThrow('OPENAI_API_KEY');
  });

  it('creates OpenAI providers when configured with an API key', () => {
    expect(createAiProviders({ provider: 'openai', apiKey: 'sk-test' }).providerName).toBe('openai');
  });
});
