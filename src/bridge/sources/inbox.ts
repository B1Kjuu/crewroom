// Inbox folder: any agent that can write a file reports here. One small .txt file per event,
// one line: "<Worker> <start|done|note|waiting>: <what>". The bridge reads each file and deletes it.
import { mkdirSync, watch } from 'node:fs';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { REPORT_STATUSES, reportEventSchema, type ReportEvent, type ReportStatus } from '../../shared/events.js';

const MAX_FILE = 4096;
const MAX_PER_SCAN = 50;
const LINE = /^(.+?)(?:\s+(start|done|note|waiting))?\s*:\s*(.*)$/i;

export function parseInboxText(text: string): { worker: string; status: ReportStatus; text: string } | null {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  if (!line) return null;
  const m = LINE.exec(line);
  if (!m) return null;
  const worker = m[1]!.trim();
  if (!worker || worker.length > 60) return null;
  const status = (m[2]?.toLowerCase() ?? 'note') as ReportStatus;
  if (!REPORT_STATUSES.includes(status)) return null;
  return { worker, status, text: m[3]!.trim().slice(0, 200) };
}

export interface InboxOptions {
  pollMs?: number;
  /** Files younger than this may still be being written; the next scan gets them. */
  minAgeMs?: number;
  /** Called for each file deleted without being shown (unreadable line, too big, empty for too long). */
  onIgnored?: (name: string, reason: string) => void;
}

const EMPTY_GIVE_UP_MS = 60_000;

export function watchInbox(dir: string, onEvent: (ev: ReportEvent) => void, opts: InboxOptions = {}): () => void {
  const { pollMs = 2000, minAgeMs = 500, onIgnored } = opts;
  mkdirSync(dir, { recursive: true });
  let busy = false;
  let again = false;
  let stopped = false;

  const scan = async () => {
    if (stopped) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    try {
      const names = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith('.txt')).sort().slice(0, MAX_PER_SCAN);
      for (const name of names) {
        const file = join(dir, name);
        try {
          const info = await stat(file);
          if (!info.isFile()) continue;
          const age = Date.now() - info.mtimeMs;
          if (info.size === 0 && age < EMPTY_GIVE_UP_MS) continue; // created, not filled in yet
          if (age < minAgeMs) continue; // may still be mid-write
          const parsed = info.size > 0 && info.size <= MAX_FILE ? parseInboxText(await readFile(file, 'utf8')) : null;
          if (stopped) return;
          await rm(file, { force: true });
          if (!parsed) {
            onIgnored?.(name, info.size > MAX_FILE ? 'over 4 KB' : info.size === 0 ? 'empty' : 'no "Worker: text" line');
            continue;
          }
          const ev = reportEventSchema.safeParse({
            event: 'Report',
            session: `inbox:${parsed.worker.toLowerCase()}`,
            source: 'inbox',
            worker: parsed.worker,
            status: parsed.status,
            text: parsed.text,
          });
          if (ev.success) onEvent(ev.data);
        } catch {
          // a file being written or already taken; the next scan gets it
        }
      }
    } catch {
      // folder gone for a moment; the poll retries
    } finally {
      busy = false;
      if (again) {
        again = false;
        void scan();
      }
    }
  };

  let timer: NodeJS.Timeout | undefined;
  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void scan(), 50);
  };
  const watcher = watch(dir, soon);
  watcher.on('error', () => {});
  // fs.watch can miss events on synced or network folders; a slow poll covers that.
  const poll = setInterval(() => void scan(), pollMs);
  poll.unref();
  void scan();

  return () => {
    stopped = true;
    clearTimeout(timer);
    clearInterval(poll);
    watcher.close();
  };
}
