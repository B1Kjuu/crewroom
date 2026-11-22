// Watches a change log (a notes vault's log.md, a project CHANGELOG) and reports each new line.
// New lines can be added at the top (newest first) or appended; both work because we diff
// against the lines already seen instead of tailing the end of the file.
import { watch } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import type { ReportEvent } from '../../shared/events.js';

const MAX_NEW = 10;
const MAX_BYTES = 5 * 1024 * 1024;

/** "date | what | page, page" -> first page, if the line has that shape. */
export function pagesOf(line: string): string | undefined {
  const cols = line.split('|');
  const first = cols[2]?.split(',')[0]?.trim();
  return first || undefined;
}

export interface LogOptions {
  pollMs?: number;
  /** A one-off message for the activity log (e.g. the file is too big to watch). */
  onNotice?: (message: string) => void;
}

export function watchLog(file: string, onEvent: (ev: ReportEvent) => void, opts: LogOptions = {}): () => void {
  const { pollMs = 5000, onNotice } = opts;
  let seen: Set<string> | null = null;
  let busy = false;
  let stopped = false;
  let tooBigSaid = false;
  let lastStamp = '';
  const session = `log:${basename(file)}`;

  const check = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const info = await stat(file);
      if (info.size > MAX_BYTES) {
        if (!tooBigSaid) onNotice?.(`${basename(file)} is over 5 MB, so crewroom stopped watching it. Start a new log file to keep it on the deck.`);
        tooBigSaid = true;
        return;
      }
      tooBigSaid = false;
      // The poll would otherwise re-read the whole file every few seconds.
      const stamp = `${info.size}:${info.mtimeMs}`;
      if (stamp === lastStamp) return;
      const lines = (await readFile(file, 'utf8')).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      lastStamp = stamp; // only after a successful read: a locked file (antivirus, editor) is tried again next poll
      if (seen === null) {
        seen = new Set(lines); // first read is the baseline: old lines are history, not news
        return;
      }
      const known = seen;
      const fresh = lines.filter((l) => !known.has(l));
      if (!fresh.length) return;
      // Newest-first log: fresh lines sit above the old ones, so flip them to oldest first.
      const firstOld = lines.findIndex((l) => known.has(l));
      const topInsert = firstOld === -1 || lines.indexOf(fresh[0]!) < firstOld;
      // Grow, never replace: a read that catches a save half-written must not make old lines look new.
      for (const l of fresh) known.add(l);
      const ordered = topInsert ? fresh.slice(0, MAX_NEW).reverse() : fresh.slice(-MAX_NEW);
      for (const line of ordered) {
        if (stopped) return;
        const ev: ReportEvent = { event: 'Report', session, source: 'log', status: 'note', text: line.slice(0, 200) };
        const page = pagesOf(line);
        if (page) ev.path = page.slice(0, 1000);
        onEvent(ev);
      }
    } catch {
      // not there yet, or mid-save; the next change or poll tries again
    } finally {
      busy = false;
    }
  };

  let timer: NodeJS.Timeout | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void check(), 50);
  };
  let watcher: ReturnType<typeof watch> | undefined;
  try {
    watcher = watch(dirname(file), (_e, name) => {
      if (!name || name === basename(file)) soon();
    });
    watcher.on('error', () => {});
  } catch {
    // folder missing: the poll keeps checking
  }
  const poll = setInterval(() => void check(), pollMs);
  poll.unref();
  void check();

  return () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(poll);
    watcher?.close();
  };
}
