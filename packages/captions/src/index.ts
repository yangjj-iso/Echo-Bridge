import {
  EchoBridgeError,
  type CaptionRevision,
  type CaptionSegment,
  type SessionSummary,
} from '@echo-bridge/shared';

export interface CaptionStats {
  total: number;
  final: number;
  partial: number;
  revised: number;
  averageConfidence?: number;
  durationMs: number;
}

export class CaptionStore {
  readonly #items = new Map<string, CaptionSegment>();

  clear(): void {
    this.#items.clear();
  }

  upsert(caption: CaptionSegment): CaptionSegment {
    assertValidTiming(caption);

    const current = this.#items.get(caption.id);
    const next = current
      ? normalizeCaption({
          ...current,
          ...caption,
          revision: Math.max(current.revision, caption.revision),
        })
      : normalizeCaption(caption);

    this.#items.set(next.id, next);
    return next;
  }

  revise(revision: CaptionRevision): CaptionSegment {
    const current = this.#items.get(revision.captionId);

    if (!current) {
      throw new EchoBridgeError({
        code: 'UNKNOWN',
        message: `Caption not found: ${revision.captionId}`,
        recoverable: true,
      });
    }

    if (revision.revision <= current.revision) {
      throw new EchoBridgeError({
        code: 'UNKNOWN',
        message: `Caption revision must increase: ${revision.captionId}`,
        recoverable: true,
      });
    }

    const next: CaptionSegment = {
      ...current,
      sourceText: revision.sourceText ?? current.sourceText,
      translatedText: revision.translatedText ?? current.translatedText,
      status: 'revised',
      revision: revision.revision,
    };

    const normalized = normalizeCaption(next);
    this.#items.set(normalized.id, normalized);
    return normalized;
  }

  list(): CaptionSegment[] {
    return [...this.#items.values()].sort((left, right) => left.startMs - right.startMs);
  }
}

export function exportMarkdown(captions: CaptionSegment[], summary?: SessionSummary): string {
  const lines = [`# ${summary?.title ?? 'EchoBridge Session Captions'}`, ''];

  if (summary) {
    lines.push(summary.summary);
    lines.push('');

    if (summary.keywords.length > 0) {
      lines.push(`Keywords: ${summary.keywords.join(', ')}`);
      lines.push('');
    }

    if (summary.takeaways.length > 0) {
      lines.push('## Takeaways');
      lines.push('');

      for (const takeaway of summary.takeaways) {
        lines.push(`- ${takeaway}`);
      }

      lines.push('');
    }
  }

  lines.push('## Captions');
  lines.push('');

  for (const caption of sortCaptions(captions)) {
    lines.push(`### ${formatTimestamp(caption.startMs)}`);
    lines.push('');
    lines.push(`- EN: ${caption.sourceText}`);
    lines.push(`- ZH: ${caption.translatedText ?? ''}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function exportSrt(captions: CaptionSegment[]): string {
  return sortCaptions(captions)
    .map((caption, index) => {
      const normalized = normalizeCaption(caption);
      const endMs = normalized.endMs ?? normalized.startMs + 3000;
      return [
        String(index + 1),
        `${formatSrtTimestamp(normalized.startMs)} --> ${formatSrtTimestamp(endMs)}`,
        normalizeSrtText(normalized.translatedText ?? normalized.sourceText),
        '',
      ].join('\n');
    })
    .join('\n');
}

export function summarizeCaptions(captions: CaptionSegment[]): CaptionStats {
  const sorted = sortCaptions(captions);
  const confidenceValues = sorted
    .map((caption) => caption.confidence)
    .filter((value): value is number => typeof value === 'number');
  const first = sorted[0];
  const last = sorted.at(-1);

  return {
    total: sorted.length,
    final: sorted.filter((caption) => caption.status === 'final').length,
    partial: sorted.filter((caption) => caption.status === 'partial').length,
    revised: sorted.filter((caption) => caption.status === 'revised').length,
    averageConfidence:
      confidenceValues.length > 0
        ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
        : undefined,
    durationMs: first && last ? (last.endMs ?? last.startMs) - first.startMs : 0,
  };
}

export function generateSessionSummary(
  sessionId: string,
  captions: CaptionSegment[],
): SessionSummary {
  const sorted = sortCaptions(captions).filter((caption) => caption.status !== 'partial');
  const sourceLines = sorted
    .map((caption) => caption.sourceText)
    .filter((text): text is string => Boolean(text));
  const translatedLines = sorted
    .map((caption) => caption.translatedText)
    .filter((text): text is string => Boolean(text));
  const title = buildSummaryTitle(sourceLines);
  const keywords = extractKeywords(sourceLines);
  const takeaways =
    translatedLines.length > 0
      ? translatedLines.slice(0, 3)
      : sourceLines.slice(0, 3).filter((line): line is string => Boolean(line));
  const summaryText =
    translatedLines.length > 0
      ? `本次会话共记录 ${sorted.length} 条字幕，主要内容包括：${translatedLines
          .slice(0, 2)
          .join(' ')}`
      : sorted.length > 0
        ? `This session recorded ${sorted.length} caption lines, mainly covering: ${sourceLines
            .slice(0, 2)
            .join(' ')}`
        : 'No finalized captions were recorded for this session.';

  return {
    sessionId,
    title,
    summary: summaryText,
    keywords,
    takeaways,
  };
}

function normalizeCaption(caption: CaptionSegment): CaptionSegment {
  assertValidTiming(caption);
  return {
    ...caption,
    sourceText: caption.sourceText.trim(),
    translatedText: caption.translatedText?.trim(),
  };
}

function assertValidTiming(caption: CaptionSegment): void {
  if (caption.startMs < 0 || (caption.endMs !== undefined && caption.endMs < caption.startMs)) {
    throw new EchoBridgeError({
      code: 'UNKNOWN',
      message: `Invalid caption timing: ${caption.id}`,
      recoverable: false,
    });
  }
}

function sortCaptions(captions: CaptionSegment[]): CaptionSegment[] {
  return [...captions].sort((left, right) => left.startMs - right.startMs);
}

function buildSummaryTitle(sourceLines: string[]): string {
  const firstLine = sourceLines[0]?.replace(/[.!?。！？]+$/g, '').trim();

  if (!firstLine) {
    return 'Untitled EchoBridge Session';
  }

  const words = firstLine.split(/\s+/).slice(0, 7).join(' ');
  return words.length > 64 ? `${words.slice(0, 61)}...` : words;
}

function extractKeywords(lines: string[]): string[] {
  const counts = new Map<string, number>();

  for (const line of lines) {
    for (const word of line.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? []) {
      const normalized = word.replace(/^-+|-+$/g, '');

      if (!normalized || stopWords.has(normalized)) {
        continue;
      }

      counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([word]) => word);
}

const stopWords = new Set([
  'about',
  'after',
  'and',
  'are',
  'can',
  'for',
  'from',
  'into',
  'the',
  'this',
  'that',
  'today',
  'when',
  'with',
  'will',
]);

function normalizeSrtText(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function formatTimestamp(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatSrtTimestamp(ms: number): string {
  const date = new Date(ms);
  const hours = Math.floor(ms / 3_600_000);
  return `${hours.toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}:${date
    .getUTCSeconds()
    .toString()
    .padStart(2, '0')},${date.getUTCMilliseconds().toString().padStart(3, '0')}`;
}
