import type { CaptionRevision, CaptionSegment } from '@echo-bridge/shared';

export interface TranslationResult {
  translatedText: string;
  revisions: CaptionRevision[];
}

export interface TranslationProvider {
  translateSegment(segment: CaptionSegment, context: CaptionSegment[]): Promise<TranslationResult>;
}

export class MockTranslationProvider implements TranslationProvider {
  async translateSegment(
    segment: CaptionSegment,
    context: CaptionSegment[],
  ): Promise<TranslationResult> {
    const translatedText = translateKnownDemoLine(segment.sourceText);
    const revisions: CaptionRevision[] = [];
    const candidate = context.find((item) => item.sourceText.includes('today technical session'));

    if (candidate && segment.sourceText.includes('architecture')) {
      revisions.push({
        captionId: candidate.id,
        revision: candidate.revision + 1,
        sourceText: 'Welcome to today\'s technical session.',
        translatedText: '欢迎来到今天的技术分享。',
        reason: 'Added possessive form after technical-session context became clear.',
      });
    }

    return { translatedText, revisions };
  }
}

function translateKnownDemoLine(text: string): string {
  if (text.includes('technical session')) {
    return '欢迎来到今天的技术分享。';
  }

  if (text.includes('translation architecture')) {
    return '我们将讨论实时翻译架构。';
  }

  if (text.includes('revise previous captions')) {
    return '当上下文变化时，系统可以修正之前的字幕。';
  }

  return `待翻译：${text}`;
}
