import type { CaptionRevision, CaptionSegment } from '@echo-bridge/shared';

export class CaptionStore {
  readonly #items = new Map<string, CaptionSegment>();

  upsert(caption: CaptionSegment): CaptionSegment {
    const current = this.#items.get(caption.id);
    const next = current ? { ...current, ...caption } : caption;
    this.#items.set(next.id, next);
    return next;
  }

  revise(revision: CaptionRevision): CaptionSegment {
    const current = this.#items.get(revision.captionId);

    if (!current) {
      throw new Error(`Caption not found: ${revision.captionId}`);
    }

    const next: CaptionSegment = {
      ...current,
      sourceText: revision.sourceText ?? current.sourceText,
      translatedText: revision.translatedText ?? current.translatedText,
      status: 'revised',
      revision: revision.revision,
    };

    this.#items.set(next.id, next);
    return next;
  }

  list(): CaptionSegment[] {
    return [...this.#items.values()].sort((left, right) => left.startMs - right.startMs);
  }
}

export function exportMarkdown(captions: CaptionSegment[]): string {
  const lines = ['# EchoBridge Session Captions', ''];

  for (const caption of captions) {
    lines.push(`## ${formatTimestamp(caption.startMs)}`);
    lines.push('');
    lines.push(`- EN: ${caption.sourceText}`);
    lines.push(`- ZH: ${caption.translatedText ?? ''}`);
    lines.push('');
  }

  return lines.join('\n');
}

export function exportSrt(captions: CaptionSegment[]): string {
  return captions
    .map((caption, index) => {
      const endMs = caption.endMs ?? caption.startMs + 3000;
      return [
        String(index + 1),
        `${formatSrtTimestamp(caption.startMs)} --> ${formatSrtTimestamp(endMs)}`,
        caption.translatedText ?? caption.sourceText,
        '',
      ].join('\n');
    })
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
