import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

const GOOD = '2026-10-28';
const EMPTY = '2026-01-01';
const BAD = '2026-01-02';
const MISSING = '2026-01-03';

const tmp = mkdtempSync(join(tmpdir(), 'rig-routes-'));
const config = {
  adapter: 'shim',
  installed: '2026-10-29T14:06:00+01:00',
  beatEverySeconds: 60,
  runsDir: tmp,
};
const app = createApp(config);

beforeAll(() => {
  writeFileSync(join(tmp, `${GOOD}.jsonl`), readFileSync(join('runs', `${GOOD}.jsonl`), 'utf8'));
  writeFileSync(join(tmp, `${EMPTY}.jsonl`), '');
  writeFileSync(
    join(tmp, `${BAD}.jsonl`),
    [
      '{"at":"2026-01-02T01:00:00+01:00","job":"a/one","status":"ok","owner":"rook"}',
      'this is not json',
      '{"at":"2026-01-02T02:00:00+01:00","job":"b/two","status":"fail","owner":null,"error":"boom"}',
    ].join('\n') + '\n',
  );
});

afterAll(() => rmSync(tmp, { recursive: true, force: true }));

// Job names in the order the page's table lists them (first cell of each body row).
function pageJobs(html: string): string[] {
  return [...html.matchAll(/<tr><td>([^<]*)<\/td>/g)].map((m) => m[1]!);
}

describe('GET /digest/:night', () => {
  it('200 for a good night', async () => {
    const res = await app.request(`/digest/${GOOD}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(`digest ${GOOD}`);
  });

  it('404 for a night with no file', async () => {
    const res = await app.request(`/digest/${MISSING}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain(`no digest for ${MISSING}`);
  });

  it('says nothing ran for an empty night', async () => {
    const res = await app.request(`/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('still renders a night with a bad line and says it', async () => {
    const res = await app.request(`/digest/${BAD}`);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toMatch(/1 line didn(&#39;|')t parse/);
    expect(pageJobs(html)).toEqual(['a/one', 'b/two']);
  });
});

describe('GET /api/digest/:night', () => {
  it('200 for a good night', async () => {
    const res = await app.request(`/api/digest/${GOOD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.night).toBe(GOOD);
    expect(body.rows.length).toBeGreaterThan(0);
  });

  it('404 for a night with no file', async () => {
    const res = await app.request(`/api/digest/${MISSING}`);
    expect(res.status).toBe(404);
  });

  it('empty night has no rows', async () => {
    const res = await app.request(`/api/digest/${EMPTY}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.rows).toEqual([]);
  });

  it('bad-line night is 200 with badLines 1', async () => {
    const res = await app.request(`/api/digest/${BAD}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Night;
    expect(body.badLines).toBe(1);
    expect(body.rows.map((r) => r.job)).toEqual(['a/one', 'b/two']);
  });
});

describe('page and JSON agree', () => {
  it.each([GOOD, BAD])('same jobs in the same order for %s', async (night) => {
    const html = await (await app.request(`/digest/${night}`)).text();
    const body = (await (await app.request(`/api/digest/${night}`)).json()) as Night;
    expect(pageJobs(html)).toEqual(body.rows.map((r) => r.job));
    expect(pageJobs(html).length).toBeGreaterThan(0);
  });
});
