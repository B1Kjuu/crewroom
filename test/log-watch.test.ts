import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pagesOf, watchLog } from '../src/bridge/sources/log.js';
import type { ReportEvent } from '../src/shared/events.js';
import { tempDir } from './helpers.js';

const stops: (() => void)[] = [];
afterEach(() => {
  while (stops.length) stops.pop()!();
});

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

function start(file: string) {
  const got: ReportEvent[] = [];
  stops.push(watchLog(file, (e) => got.push(e), { pollMs: 100 }));
  return got;
}

describe('pagesOf', () => {
  it('takes the first page from the third column', () => {
    expect(pagesOf('2026-11-22 | morning brief | daily/2026-11-22.md, daily/open.md')).toBe('daily/2026-11-22.md');
    expect(pagesOf('just a line')).toBeUndefined();
  });
});

describe('watchLog', () => {
  it('says once when a log is too big to watch, instead of going quiet', async () => {
    const file = join(tempDir(), 'log.md');
    writeFileSync(file, 'x'.repeat(5 * 1024 * 1024 + 10));
    const notices: string[] = [];
    stops.push(watchLog(file, () => {}, { pollMs: 100, onNotice: (m) => notices.push(m) }));
    await settle(600);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/5 MB/);
  });

  it('ignores what is already in the file', async () => {
    const file = join(tempDir(), 'log.md');
    writeFileSync(file, 'old 2\nold 1\n');
    const got = start(file);
    await settle();
    expect(got).toEqual([]);
  });

  it('emits lines added at the top, oldest first', async () => {
    const file = join(tempDir(), 'log.md');
    writeFileSync(file, 'old\n');
    const got = start(file);
    await settle(500); // let the first read (the baseline) finish
    writeFileSync(file, 'new 2 | b | daily/b.md\nnew 1 | a | daily/a.md\nold\n');
    await settle();
    expect(got.map((e) => e.text)).toEqual(['new 1 | a | daily/a.md', 'new 2 | b | daily/b.md']);
    expect(got[0]).toMatchObject({ event: 'Report', source: 'log', status: 'note', path: 'daily/a.md', session: 'log:log.md' });
  });

  it('emits lines appended at the bottom, in order', async () => {
    const file = join(tempDir(), 'log.md');
    writeFileSync(file, 'old\n');
    const got = start(file);
    await settle(500); // let the first read (the baseline) finish
    writeFileSync(file, 'old\nnew 1\nnew 2\n');
    await settle();
    expect(got.map((e) => e.text)).toEqual(['new 1', 'new 2']);
  });

  it('emits at most 10 lines per change', async () => {
    const file = join(tempDir(), 'log.md');
    writeFileSync(file, 'old\n');
    const got = start(file);
    await settle(500); // let the first read (the baseline) finish
    writeFileSync(file, Array.from({ length: 25 }, (_, i) => `line ${i}`).join('\n'));
    await settle();
    expect(got).toHaveLength(10);
  });

  it('a save caught half-written does not replay old lines', async () => {
    const file = join(tempDir(), 'log.md');
    writeFileSync(file, 'c\nb\na\n');
    const got = start(file);
    await settle(500); // let the first read (the baseline) finish
    writeFileSync(file, 'c\n'); // a sync tool mid-write
    await settle();
    writeFileSync(file, 'c\nb\na\n');
    await settle();
    expect(got).toEqual([]);
  });

  it('a file that appears later is read as a baseline first', async () => {
    const file = join(tempDir(), 'log.md');
    const got = start(file);
    await settle(500); // let the first read (the baseline) finish
    writeFileSync(file, 'first\n');
    await settle();
    expect(got).toEqual([]);
    writeFileSync(file, 'second\nfirst\n');
    await settle();
    expect(got.map((e) => e.text)).toEqual(['second']);
  });

  it('skips blank lines and caps text at 200 chars', async () => {
    const file = join(tempDir(), 'log.md');
    writeFileSync(file, 'old\n');
    const got = start(file);
    await settle(500); // let the first read (the baseline) finish
    writeFileSync(file, '\n   \n' + 'y'.repeat(300) + '\nold\n');
    await settle();
    expect(got).toHaveLength(1);
    expect(got[0]!.text).toHaveLength(200);
  });
});
