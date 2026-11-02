import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

const tmp = mkdtempSync(join(tmpdir(), 'rig-digest-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('readNight on runs/2026-10-28.jsonl', () => {
  const night = readNight('runs', '2026-10-28');

  it('reads 5 jobs sorted by job and counts the 1 bad line', () => {
    expect(night).not.toBeNull();
    expect(night!.night).toBe('2026-10-28');
    expect(night!.rows.map((r) => r.job)).toEqual([
      'digest/render',
      'fixtures/refresh',
      'lane/sync',
      'notes/backup',
      'rig/rotate-logs',
    ]);
    expect(night!.badLines).toBe(1);
    expect(night!.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
  });

  it('rolls up fixtures/refresh', () => {
    const row = night!.rows.find((r) => r.job === 'fixtures/refresh');
    expect(row).toEqual({
      job: 'fixtures/refresh',
      owner: 'rook',
      runs: 4,
      retries: 3,
      lastStatus: 'ok',
      lastError: 'upstream 503',
      firstAt: '2026-10-29T01:30:00+01:00',
      lastAt: '2026-10-29T01:37:00+01:00',
    });
  });

  it('keeps a row with a null owner', () => {
    const row = night!.rows.find((r) => r.job === 'digest/render');
    expect(row?.owner).toBeNull();
    expect(row?.lastError).toBeNull();
  });

  it('keeps times with the offset from the log', () => {
    const row = night!.rows.find((r) => r.job === 'lane/sync');
    expect(row?.firstAt).toBe('2026-10-28T23:00:06+01:00');
    expect(row?.lastAt).toBe('2026-10-29T05:00:04+01:00');
  });
});

describe('readNight edges', () => {
  it('returns null for a night with no file', () => {
    expect(readNight('runs', '1999-01-01')).toBeNull();
  });

  it('reads an empty file as an empty night', () => {
    writeFileSync(join(tmp, '2026-01-01.jsonl'), '');
    expect(readNight(tmp, '2026-01-01')).toEqual({
      night: '2026-01-01',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it('counts lines that fail validation and ignores blank trailing lines', () => {
    const lines = [
      '{"at":"2026-01-02T01:00:00+01:00","job":"a","status":"ok","owner":"x"}',
      '{"job":"a","status":"ok","owner":"x"}',
      '{"at":"2026-01-02T01:00:00+01:00","status":"ok","owner":"x"}',
      '{"at":"2026-01-02T01:00:00+01:00","job":"a","status":"done","owner":"x"}',
      '[1,2]',
      '',
      '',
    ];
    writeFileSync(join(tmp, '2026-01-02.jsonl'), lines.join('\n'));
    const night = readNight(tmp, '2026-01-02');
    expect(night?.badLines).toBe(4);
    expect(night?.rows).toHaveLength(1);
  });
});
