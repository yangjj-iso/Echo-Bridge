import { describe, expect, it } from 'vitest';

import { CaptionStore, exportMarkdown, exportSrt } from './index.js';

describe('CaptionStore', () => {
  it('tracks caption revisions without losing timing metadata', () => {
    const store = new CaptionStore();

    store.upsert({
      id: 'caption-1',
      startMs: 1000,
      endMs: 3000,
      sourceText: 'The module handles cashing.',
      translatedText: '该模块处理现金。',
      status: 'final',
      revision: 0,
    });

    const revised = store.revise({
      captionId: 'caption-1',
      revision: 1,
      sourceText: 'The module handles caching.',
      translatedText: '该模块处理缓存。',
      reason: 'Corrected domain term from later context.',
    });

    expect(revised.startMs).toBe(1000);
    expect(revised.status).toBe('revised');
    expect(revised.translatedText).toBe('该模块处理缓存。');
  });
});

describe('caption exports', () => {
  const captions = [
    {
      id: 'caption-1',
      startMs: 0,
      endMs: 2500,
      sourceText: 'Welcome to the conference.',
      translatedText: '欢迎参加本次会议。',
      status: 'final' as const,
      revision: 0,
    },
  ];

  it('exports Markdown with bilingual text', () => {
    expect(exportMarkdown(captions)).toContain('- EN: Welcome to the conference.');
    expect(exportMarkdown(captions)).toContain('- ZH: 欢迎参加本次会议。');
  });

  it('exports SRT with translated caption text', () => {
    expect(exportSrt(captions)).toContain('00:00:00,000 --> 00:00:02,500');
    expect(exportSrt(captions)).toContain('欢迎参加本次会议。');
  });
});
