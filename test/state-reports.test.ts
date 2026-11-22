import { describe, expect, it } from 'vitest';
import { CrewState, IDLE_AFTER_STOP_MS, NOTE_MS, REPORT_TIMEOUT_MS } from '../src/bridge/state.js';
import type { OfficeConfig } from '../src/shared/config-schema.js';
import type { ReportEvent, ServerMsg, WorkerView } from '../src/shared/events.js';

const config = (over: Partial<OfficeConfig> = {}): OfficeConfig => ({
  office: { name: 'Deck', setting: 'crew-deck' },
  workers: [
    { id: 'writer', name: 'Writer', sprite: 'crew-4', color: '#5fd08a', home: 'console-4' },
    { id: 'advisor', name: 'Advisor', sprite: 'crew-7', color: '#9aa4ff', home: 'console-7' },
  ],
  rules: [{ worker: 'advisor', when: { source: 'log', text: '*brief*' } }],
  fallback: 'per-session',
  actions: {},
  layout: null,
  sources: { inbox: { enabled: true, path: null }, log: [], webhook: { enabled: true } },
  ...over,
});

const rep = (e: Partial<ReportEvent>): ReportEvent => ({ event: 'Report', session: 'inbox:x', source: 'inbox', status: 'note', ...e });
const last = (msgs: ServerMsg[], id: string): WorkerView | undefined =>
  msgs.flatMap((m) => (m.type === 'worker' && m.worker.id === id ? [m.worker] : [])).at(-1);

describe('reports', () => {
  it('a named worker starts working, matched by name case-insensitively', () => {
    const s = new CrewState(config());
    const m = s.apply(rep({ worker: 'WRITER', status: 'start', text: 'drafting a caption' }), 0);
    expect(last(m, 'writer')).toMatchObject({ state: 'working', anim: 'type', label: 'drafting a caption', sessions: 1 });
  });

  it('matches by worker id too', () => {
    const s = new CrewState(config());
    expect(last(s.apply(rep({ worker: 'writer', status: 'start' }), 0), 'writer')?.state).toBe('working');
  });

  it('start stays working until done, then idle after 4 s', () => {
    const s = new CrewState(config());
    s.apply(rep({ worker: 'writer', status: 'start', text: 'a' }), 0);
    expect(last(s.tick(NOTE_MS * 5), 'writer')).toBeUndefined();
    s.apply(rep({ worker: 'writer', status: 'done', text: 'a' }), NOTE_MS * 5);
    expect(last(s.tick(NOTE_MS * 5 + IDLE_AFTER_STOP_MS), 'writer')?.state).toBe('idle');
  });

  it('a note works for 60 s, then idles', () => {
    const s = new CrewState(config());
    s.apply(rep({ worker: 'writer', status: 'note', text: 'sent reply' }), 0);
    expect(last(s.tick(NOTE_MS - 1), 'writer')).toBeUndefined();
    expect(last(s.tick(NOTE_MS), 'writer')?.state).toBe('idle');
  });

  it('waiting shows the !', () => {
    const s = new CrewState(config());
    expect(last(s.apply(rep({ worker: 'writer', status: 'waiting', text: 'pick a caption' }), 0), 'writer')).toMatchObject({ state: 'waiting', anim: 'wait', label: 'pick a caption' });
  });

  it('long text is cut to 40 chars in the label', () => {
    const s = new CrewState(config());
    const m = s.apply(rep({ worker: 'writer', status: 'start', text: 'x'.repeat(80) }), 0);
    expect(last(m, 'writer')?.label).toHaveLength(40);
  });

  it('a log line goes to the worker a rule names', () => {
    const s = new CrewState(config());
    const m = s.apply(rep({ source: 'log', session: 'log:vault', text: '2026-11-22 | morning brief | daily/2026-11-22.md' }), 0);
    expect(last(m, 'advisor')?.state).toBe('working');
  });

  it('log lines for different workers keep both on the deck, one session each', () => {
    const s = new CrewState(config({ rules: [
      { worker: 'advisor', when: { source: 'log', text: '*brief*' } },
      { worker: 'writer', when: { source: 'log', text: '*caption*' } },
    ] }));
    s.apply(rep({ source: 'log', session: 'log:log.md', text: 'morning brief' }), 0);
    s.apply(rep({ source: 'log', session: 'log:log.md', text: 'caption drafted' }), 1);
    s.apply(rep({ source: 'log', session: 'log:log.md', text: 'evening brief' }), 2);
    const snap = s.snapshot(null).workers;
    expect(snap.find((w) => w.id === 'advisor')).toMatchObject({ state: 'working', sessions: 1 });
    expect(snap.find((w) => w.id === 'writer')).toMatchObject({ state: 'working', sessions: 1 });
  });

  it('an unmatched log line is ignored: no worker, no log entry', () => {
    const s = new CrewState(config());
    expect(s.apply(rep({ source: 'log', session: 'log:vault', text: '2026-11-22 | fixed a typo | index.md' }), 0)).toEqual([]);
  });

  it('an unknown worker name from the inbox falls back like any other session', () => {
    const s = new CrewState(config());
    const m = s.apply(rep({ worker: 'Ghost', session: 'inbox:ghost', status: 'start' }), 0);
    expect(m.some((x) => x.type === 'worker' && x.worker.generic)).toBe(true);
  });

  it('two unknown reporters get their own crewmember, named as they reported', () => {
    const s = new CrewState(config());
    s.apply(rep({ worker: 'Codex', session: 'inbox:codex', status: 'start' }), 0);
    s.apply(rep({ worker: 'Cowork', session: 'inbox:cowork', status: 'start' }), 1);
    const generics = s.snapshot(null).workers.filter((w) => w.generic);
    expect(generics.map((w) => [w.name, w.sessions])).toEqual([['Codex', 1], ['Cowork', 1]]);
  });

  it('caps unknown reporters so a flood of names cannot fill the deck', () => {
    const s = new CrewState(config());
    for (let i = 0; i < 40; i++) s.apply(rep({ worker: `Bot${i}`, session: `inbox:bot${i}`, status: 'start' }), i);
    expect(s.snapshot(null).workers.filter((w) => w.generic).length).toBeLessThanOrEqual(12);
  });

  it('a worker waiting on you stays waiting when a newer report arrives', () => {
    const s = new CrewState(config({ fallback: 'advisor' }));
    s.apply({ event: 'PreToolUse', session: 'claude-1', tool: 'Bash' }, 0);
    s.apply({ event: 'Notification', session: 'claude-1' }, 1);
    s.apply(rep({ source: 'log', session: 'log:log.md', text: 'morning brief' }), 2);
    expect(s.snapshot(null).workers.find((w) => w.id === 'advisor')?.state).toBe('waiting');
  });

  it('a finished report stops counting toward the ×N badge', () => {
    const s = new CrewState(config({ fallback: 'advisor' }));
    s.apply({ event: 'PreToolUse', session: 'claude-1', tool: 'Bash' }, 0);
    s.apply(rep({ source: 'log', session: 'log:log.md', text: 'morning brief' }), 1);
    s.tick(1 + NOTE_MS);
    expect(s.snapshot(null).workers.find((w) => w.id === 'advisor')).toMatchObject({ state: 'working', sessions: 1 });
  });

  it('a report session is dropped after 30 min of silence', () => {
    const s = new CrewState(config());
    s.apply(rep({ worker: 'writer', status: 'start' }), 0);
    expect(last(s.tick(REPORT_TIMEOUT_MS - 1), 'writer')).toBeUndefined();
    expect(last(s.tick(REPORT_TIMEOUT_MS), 'writer')?.state).toBe('away');
  });

  it('logs reports with their label', () => {
    const s = new CrewState(config());
    const m = s.apply(rep({ worker: 'writer', status: 'start', text: 'caption' }), 5);
    expect(m.find((x) => x.type === 'log')).toEqual({ type: 'log', entry: { t: 5, worker: 'writer', event: 'Report', label: 'caption' } });
  });
});
