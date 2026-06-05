import { describe, expect, it } from 'vitest';

import {
  CaptionStore,
  exportMarkdown,
  exportSrt,
  generateSessionSummary,
  summarizeCaptions,
} from './index.js';

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

  it('rejects stale revisions so older AI updates cannot overwrite newer captions', () => {
    const store = new CaptionStore();

    store.upsert({
      id: 'caption-1',
      startMs: 1000,
      sourceText: 'Initial caption',
      status: 'final',
      revision: 2,
    });

    expect(() =>
      store.revise({
        captionId: 'caption-1',
        revision: 2,
        translatedText: '旧更新',
        reason: 'Stale provider response.',
      }),
    ).toThrow('Caption revision must increase');
  });

  it('rejects invalid caption timing', () => {
    const store = new CaptionStore();

    expect(() =>
      store.upsert({
        id: 'caption-1',
        startMs: 3000,
        endMs: 2000,
        sourceText: 'Invalid timing',
        status: 'final',
        revision: 0,
      }),
    ).toThrow('Invalid caption timing');
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

  it('exports Markdown with a session summary section', () => {
    const summary = generateSessionSummary('session-1', captions);
    const markdown = exportMarkdown(captions, summary);

    expect(markdown).toContain('# Welcome to the conference');
    expect(markdown).toContain('本次会话共记录 1 条字幕');
    expect(markdown).toContain('## Takeaways');
    expect(markdown).toContain('## Captions');
  });

  it('exports SRT with translated caption text', () => {
    expect(exportSrt(captions)).toContain('00:00:00,000 --> 00:00:02,500');
    expect(exportSrt(captions)).toContain('欢迎参加本次会议。');
  });

  it('sorts captions and normalizes multiline SRT text', () => {
    const srt = exportSrt([
      {
        id: 'caption-2',
        startMs: 3000,
        sourceText: 'Second',
        translatedText: '第二句',
        status: 'final',
        revision: 0,
      },
      {
        id: 'caption-1',
        startMs: 0,
        endMs: 1000,
        sourceText: 'First',
        translatedText: ' 第一行 \n\n 第二行 ',
        status: 'final',
        revision: 0,
      },
    ]);

    expect(srt).toContain('1\n00:00:00,000 --> 00:00:01,000\n第一行\n第二行');
    expect(srt).toContain('2\n00:00:03,000 --> 00:00:06,000\n第二句');
  });
});

describe('caption stats', () => {
  it('summarizes caption quality signals', () => {
    expect(
      summarizeCaptions([
        {
          id: 'caption-1',
          startMs: 0,
          endMs: 1000,
          sourceText: 'First',
          status: 'final',
          confidence: 0.8,
          revision: 0,
        },
        {
          id: 'caption-2',
          startMs: 1000,
          endMs: 2000,
          sourceText: 'Second',
          status: 'revised',
          confidence: 1,
          revision: 1,
        },
      ]),
    ).toMatchObject({
      total: 2,
      final: 1,
      revised: 1,
      averageConfidence: 0.9,
      durationMs: 2000,
    });
  });
});

describe('session summaries', () => {
  it('generates deterministic titles, keywords, and takeaways from captions', () => {
    const summary = generateSessionSummary('session-1', [
      {
        id: 'caption-1',
        startMs: 0,
        endMs: 1000,
        sourceText: 'Realtime translation architecture improves meeting captions.',
        translatedText: '实时翻译架构可以改善会议字幕。',
        status: 'final',
        revision: 0,
      },
      {
        id: 'caption-2',
        startMs: 1000,
        endMs: 2000,
        sourceText: 'The architecture can revise captions when context changes.',
        translatedText: '当上下文变化时，该架构可以修正字幕。',
        status: 'revised',
        revision: 1,
      },
    ]);

    expect(summary).toMatchObject({
      sessionId: 'session-1',
      title: 'Realtime translation architecture improves meeting captions',
      takeaways: ['实时翻译架构可以改善会议字幕。', '当上下文变化时，该架构可以修正字幕。'],
    });
    expect(summary.keywords).toContain('architecture');
    expect(summary.keywords).toContain('captions');
  });
});
