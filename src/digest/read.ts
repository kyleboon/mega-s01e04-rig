import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, Night, ReadNight, RunLine, RunStatus } from './types.js';

const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

function isStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Parse one line of the log at the edge. null means a bad line.
export function parseLine(text: string): RunLine | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const { at, job, status, owner, error } = raw;
  if (typeof at !== 'string' || at === '' || Number.isNaN(Date.parse(at))) return null;
  if (typeof job !== 'string' || job === '') return null;
  if (!isStatus(status)) return null;
  if (owner !== undefined && owner !== null && typeof owner !== 'string') return null;
  if (error !== undefined && typeof error !== 'string') return null;
  const line: RunLine = { at, job, status, owner: owner ?? null };
  if (error !== undefined) line.error = error;
  return line;
}

function readFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (isRecord(err) && err.code === 'ENOENT') return null;
    throw err;
  }
}

function toRow(job: string, lines: RunLine[]): DigestRow {
  // Order by instant (offsets differ across DST), file order breaks ties. `at` strings are kept as logged.
  const ordered = lines
    .map((line, index) => ({ line, index, ms: Date.parse(line.at) }))
    .sort((a, b) => a.ms - b.ms || a.index - b.index)
    .map((entry) => entry.line);
  const first = ordered[0]!;
  const last = ordered[ordered.length - 1]!;
  const lastWithError = ordered.findLast((line) => line.error !== undefined);
  const lastWithOwner = ordered.findLast((line) => line.owner !== null);
  return {
    job,
    owner: lastWithOwner?.owner ?? null,
    runs: ordered.length,
    retries: ordered.filter((line) => line.status === 'retry').length,
    lastStatus: last.status,
    lastError: lastWithError?.error ?? null,
    firstAt: first.at,
    lastAt: last.at,
  };
}

export const readNight: ReadNight = (runsDir, night) => {
  const text = readFile(join(runsDir, `${night}.jsonl`));
  if (text === null) return null;

  const byJob = new Map<string, RunLine[]>();
  const counts: Record<RunStatus, number> = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.trim() === '') continue;
    const line = parseLine(rawLine);
    if (line === null) {
      badLines += 1;
      continue;
    }
    counts[line.status] += 1;
    const lines = byJob.get(line.job);
    if (lines) lines.push(line);
    else byJob.set(line.job, [line]);
  }

  const rows = [...byJob.entries()]
    .map(([job, lines]) => toRow(job, lines))
    .sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));

  return { night, rows, badLines, counts };
};
