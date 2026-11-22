import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseInboxText, watchInbox } from '../src/bridge/sources/inbox.js';
import type { ReportEvent } from '../src/shared/events.js';
import { tempDir } from './helpers.js';

describe('parseInboxText', () => {
  it('reads worker, status and text', () => {
    expect(parseInboxText('Writer start: drafting a caption')).toEqual({ worker: 'Writer', status: 'start', text: 'drafting a caption' });
  });
  it('status is optional and defaults to note', () => {
    expect(parseInboxText('Operator: replied to Hubert')).toEqual({ worker: 'Operator', status: 'note', text: 'replied to Hubert' });
  });
  it('handles names with spaces and any case', () => {
    expect(parseInboxText('Crew 1 DONE: render finished')).toEqual({ worker: 'Crew 1', status: 'done', text: 'render finished' });
  });
  it('uses the first non-empty line and trims', () => {
    expect(parseInboxText('\n\n  Editor waiting: approve v3  \nmore')).toEqual({ worker: 'Editor', status: 'waiting', text: 'approve v3' });
  });
  it('rejects text without a colon or worker', () => {
    expect(parseInboxText('just some words')).toBeNull();
    expect(parseInboxText(': no worker')).toBeNull();
    expect(parseInboxText('')).toBeNull();
  });
  it('caps text at 200 chars', () => {
    expect(parseInboxText('Writer: ' + 'x'.repeat(500))?.text).toHaveLength(200);
  });
});

const stops: (() => void)[] = [];
afterEach(() => {
  while (stops.length) stops.pop()!();
});

function start(dir: string) {
  const got: ReportEvent[] = [];
  stops.push(watchInbox(dir, (e) => got.push(e), { pollMs: 100 }));
  const waitFor = async (n: number, ms = 3000) => {
    const t = Date.now();
    while (got.length < n && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 25));
    return got;
  };
  return { got, waitFor };
}

describe('watchInbox', () => {
  it('creates the folder if missing', () => {
    const dir = join(tempDir(), 'inbox');
    start(dir);
    expect(existsSync(dir)).toBe(true);
  });

  it('picks up files already there at start, then deletes them', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '1.txt'), 'Writer start: caption');
    const { waitFor } = start(dir);
    expect(await waitFor(1)).toEqual([
      { event: 'Report', session: 'inbox:writer', source: 'inbox', worker: 'Writer', status: 'start', text: 'caption' },
    ]);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('applies files in name order', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, '2.txt'), 'Editor done: v3');
    writeFileSync(join(dir, '1.txt'), 'Editor start: v3');
    const { waitFor } = start(dir);
    const got = await waitFor(2);
    expect(got.map((e) => e.status)).toEqual(['start', 'done']);
  });

  it('leaves an empty file alone until the writer fills it', async () => {
    const dir = tempDir();
    const { got, waitFor } = start(dir);
    writeFileSync(join(dir, 'p.txt'), '');
    await new Promise((r) => setTimeout(r, 900));
    expect(readdirSync(dir)).toEqual(['p.txt']);
    expect(got).toEqual([]);
    writeFileSync(join(dir, 'p.txt'), 'Writer start: filled in later');
    expect((await waitFor(1))[0]?.text).toBe('filled in later');
  });

  it('reports files it could not read as ignored', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'bad.txt'), 'no colon here');
    const ignored: string[] = [];
    stops.push(watchInbox(dir, () => {}, { pollMs: 100, minAgeMs: 0, onIgnored: (name) => ignored.push(name) }));
    const t = Date.now();
    while (!ignored.length && Date.now() - t < 3000) await new Promise((r) => setTimeout(r, 25));
    expect(ignored).toEqual(['bad.txt']);
  });

  it('deletes unreadable lines and oversized files without emitting', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'bad.txt'), 'no colon here');
    writeFileSync(join(dir, 'big.txt'), 'Writer: ' + 'x'.repeat(5000));
    writeFileSync(join(dir, 'ok.txt'), 'Writer: fine');
    const { waitFor } = start(dir);
    const got = await waitFor(1);
    await new Promise((r) => setTimeout(r, 300));
    expect(got.map((e) => e.text)).toEqual(['fine']);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('leaves files that are not .txt alone', async () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'notes.md'), 'Writer: hi');
    const { got } = start(dir);
    await new Promise((r) => setTimeout(r, 300));
    expect(got).toEqual([]);
    expect(readdirSync(dir)).toEqual(['notes.md']);
  });
});
