import { EchoBridgeError, type CaptionRevision, type CaptionSegment } from '@echo-bridge/shared';

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
      ? normalizeCaption({ ...current, ...caption, revision: Math.max(current.revision, caption.revision) })
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

export function exportMarkdown(captions: CaptionSegment[]): string {
  const lines = ['# EchoBridge Session Captions', ''];

  for (const caption of sortCaptions(captions)) {
    lines.push(`## ${formatTimestamp(caption.startMs)}`);
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
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
    .toString()
    .padStart(2, '0')}`;
}

function formatSrtTimestamp(ms: number): string {
  const date = new Date(ms);
  const hours = Math.floor(ms / 3_600_000);
  return `${hours.toString().padStart(2, '0')}:${date.getUTCMinutes().toString().padStart(2, '0')}:${date
    .getUTCSeconds()
    .toString()
    .padStart(2, '0')},${date.getUTCMilliseconds().toString().padStart(3, '0')}`;
}
