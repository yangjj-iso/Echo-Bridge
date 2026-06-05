import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { summarizeCaptions } from '@echo-bridge/captions';
import type { SessionHistoryItem, SessionRecord } from '@echo-bridge/shared';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const sessionsDir = path.resolve(moduleDirectory, '../../../data/sessions');

export async function saveSessionRecord(record: SessionRecord): Promise<SessionHistoryItem | undefined> {
  if (!record.sessionId || record.captions.length === 0) {
    return undefined;
  }

  await mkdir(sessionsDir, { recursive: true });
  const normalized: SessionRecord = {
    ...record,
    endedAt: record.endedAt ?? new Date().toISOString(),
    status: 'idle',
  };

  await writeFile(sessionPath(record.sessionId), JSON.stringify(normalized, null, 2), 'utf8');
  return toHistoryItem(normalized);
}

export async function listSessionHistory(): Promise<SessionHistoryItem[]> {
  await mkdir(sessionsDir, { recursive: true });
  const files = await readdir(sessionsDir);
  const records = await Promise.all(
    files
      .filter((file) => file.endsWith('.json'))
      .map(async (file) => readSessionRecord(file.replace(/\.json$/, ''))),
  );

  return records
    .filter((record): record is SessionRecord => Boolean(record))
    .map(toHistoryItem)
    .sort((left, right) => (right.startedAt ?? '').localeCompare(left.startedAt ?? ''));
}

export async function readSessionRecord(sessionId: string): Promise<SessionRecord | undefined> {
  try {
    return JSON.parse(await readFile(sessionPath(sessionId), 'utf8')) as SessionRecord;
  } catch {
    return undefined;
  }
}

function sessionPath(sessionId: string): string {
  return path.join(sessionsDir, `${safeFileName(sessionId)}.json`);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function toHistoryItem(record: SessionRecord): SessionHistoryItem {
  const stats = summarizeCaptions(record.captions);

  return {
    sessionId: record.sessionId ?? 'unknown',
    startedAt: record.startedAt,
    endedAt: record.endedAt,
    captionCount: record.captions.length,
    durationMs: stats.durationMs,
    revisedCount: stats.revised,
  };
}
