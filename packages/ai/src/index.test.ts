import { describe, expect, it } from 'vitest';

import { OpenAiRealtimeTranslationProvider, createAiProviders } from './index.js';

describe('createAiProviders', () => {
  it('uses mock providers by default', () => {
    expect(createAiProviders({})).toMatchObject({
      providerName: 'mock',
      providerMode: 'mock',
    });
  });

  it('requires an API key for OpenAI providers', () => {
    expect(() => createAiProviders({ provider: 'openai' })).toThrow('OPENAI_API_KEY');
  });

  it('creates OpenAI providers when configured with an API key', () => {
    expect(createAiProviders({ provider: 'openai', apiKey: 'sk-test' })).toMatchObject({
      providerName: 'openai',
      providerMode: 'buffered',
    });
  });

  it('can create a realtime translation transcription provider', () => {
    const providers = createAiProviders({
      provider: 'openai',
      apiKey: 'sk-test',
      openAiMode: 'realtime',
    });

    expect(providers.transcriptionProvider).toBeInstanceOf(OpenAiRealtimeTranslationProvider);
    expect(providers.providerMode).toBe('realtime');
  });
});
