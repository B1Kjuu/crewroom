import { describe, expect, it } from 'vitest';
import { CrewState, IDLE_AFTER_STOP_MS, LOG_SIZE, SESSION_TIMEOUT_MS } from '../src/bridge/state.js';
import type { OfficeConfig } from '../src/shared/config-schema.js';
import type { CrewEvent, ServerMsg, WorkerView } from '../src/shared/events.js';

const config = (over: Partial<OfficeConfig> = {}): OfficeConfig => ({
  office: { name: 'Test deck', setting: 'crew-deck' },
  workers: [
    { id: 'developer', name: 'Developer', sprite: 'crew-1', color: '#e8452c', home: 'console-1' },
    { id: 'editor', name: 'Editor', sprite: 'crew-2', color: '#3aa7ff', home: 'console-2' },
  ],
  rules: [
    { worker: 'editor', when: { skill: 'b1kjuu-editor' } },
    { worker: 'editor', when: { tool: 'mcp__capcut__*' }, action: 'editing' },
    { worker: 'developer', when: { skill: 'b1kjuu-dev' } },
  ],
  fallback: 'per-session',
  actions: { editing: { label: 'editing', anim: 'type' } },
  layout: null,
  sources: { inbox: { enabled: true, path: null }, log: [], webhook: { enabled: true } },
  ...over,
});

const ev = (e: Partial<CrewEvent>): CrewEvent => ({ event: 'PreToolUse', session: 'sess-aaaaaa', ...e });
const workers = (msgs: ServerMsg[]): WorkerView[] =>
  msgs.flatMap((m) => (m.type === 'worker' ? [m.worker] : []));
const lastWorker = (msgs: ServerMsg[], id: string) => workers(msgs).filter((w) => w.id === id).at(-1);

describe('CrewState', () => {
  it('starts with config workers away', () => {
    const s = new CrewState(config());
    const snap = s.snapshot(null);
    expect(snap.workers.map((w) => [w.id, w.state])).toEqual([
      ['developer', 'away'],
      ['editor', 'away'],
    ]);
    expect(snap.office).toEqual({ name: 'Test deck', setting: 'crew-deck' });
    expect(snap.configError).toBeNull();
  });

  it('skill call sets the worker and later tools keep it', () => {
    const s = new CrewState(config());
    const a = s.apply(ev({ tool: 'Skill', skill: 'b1kjuu-editor' }), 0);
    expect(lastWorker(a, 'editor')).toMatchObject({ state: 'working', sessions: 1 });
    const b = s.apply(ev({ tool: 'Bash', command: 'ls' }), 100);
    expect(lastWorker(b, 'editor')).toMatchObject({ state: 'working', anim: 'run', label: 'Bash' });
  });

  it('a skill call is labelled with the skill name', () => {
    const s = new CrewState(config());
    const m = s.apply(ev({ tool: 'Skill', skill: 'b1kjuu-editor' }), 0);
    expect(lastWorker(m, 'editor')?.label).toBe('b1kjuu-editor');
  });

  it('rule action overrides default anim', () => {
    const s = new CrewState(config());
    const m = s.apply(ev({ tool: 'mcp__capcut__capcut_save' }), 0);
    expect(lastWorker(m, 'editor')).toMatchObject({ anim: 'type', label: 'editing', action: 'editing' });
  });

  it('per-session fallback creates Crew 1 then Crew 2', () => {
    const s = new CrewState(config());
    const a = s.apply(ev({ session: 'aaaaaa-1', tool: 'Read' }), 0);
    const b = s.apply(ev({ session: 'bbbbbb-2', tool: 'Read' }), 0);
    expect(workers(a)[0]).toMatchObject({ id: 'session-aaaaaa', name: 'Crew 1', generic: true, home: 'console-3', anim: 'read' });
    expect(workers(b)[0]).toMatchObject({ id: 'session-bbbbbb', name: 'Crew 2', generic: true, home: 'console-4' });
  });

  it('generic crew go to the lounge when no console is free', () => {
    const s = new CrewState(config());
    let last: WorkerView | undefined;
    for (let i = 0; i < 7; i++) last = workers(s.apply(ev({ session: `s${i}xxxxx`, tool: 'Read' }), 0))[0];
    expect(last?.home).toBe('lounge');
  });

  it('fallback worker id', () => {
    const s = new CrewState(config({ fallback: 'developer' }));
    const m = s.apply(ev({ tool: 'Read' }), 0);
    expect(lastWorker(m, 'developer')).toMatchObject({ state: 'working' });
    expect(s.snapshot(null).workers.some((w) => w.generic)).toBe(false);
  });

  it('two sessions on one worker show sessions: 2, then 1 after SessionEnd', () => {
    const s = new CrewState(config());
    s.apply(ev({ session: 'one', skill: 'b1kjuu-editor' }), 0);
    const m = s.apply(ev({ session: 'two', skill: 'b1kjuu-editor' }), 10);
    expect(lastWorker(m, 'editor')?.sessions).toBe(2);
    const end = s.apply(ev({ session: 'one', event: 'SessionEnd' }), 20);
    expect(lastWorker(end, 'editor')?.sessions).toBe(1);
  });

  it('stop goes idle after 4 s', () => {
    const s = new CrewState(config());
    s.apply(ev({ skill: 'b1kjuu-editor' }), 0);
    s.apply(ev({ event: 'Stop' }), 0);
    expect(lastWorker(s.tick(IDLE_AFTER_STOP_MS - 1), 'editor')).toBeUndefined();
    expect(lastWorker(s.tick(IDLE_AFTER_STOP_MS), 'editor')).toMatchObject({ state: 'idle' });
  });

  it('snapshot after going idle shows idle', () => {
    const s = new CrewState(config());
    s.apply(ev({ skill: 'b1kjuu-editor' }), 0);
    s.apply(ev({ event: 'Stop' }), 0);
    s.tick(IDLE_AFTER_STOP_MS);
    expect(s.snapshot(null).workers.find((w) => w.id === 'editor')?.state).toBe('idle');
  });

  it('a new event after stop cancels idle', () => {
    const s = new CrewState(config());
    s.apply(ev({ skill: 'b1kjuu-editor' }), 0);
    s.apply(ev({ event: 'Stop' }), 0);
    s.apply(ev({ event: 'UserPromptSubmit' }), 2000);
    expect(lastWorker(s.tick(4000), 'editor')).toBeUndefined();
    expect(s.snapshot(null).workers.find((w) => w.id === 'editor')).toMatchObject({ state: 'working', anim: 'think' });
  });

  it('notification shows waiting', () => {
    const s = new CrewState(config());
    s.apply(ev({ skill: 'b1kjuu-editor' }), 0);
    const m = s.apply(ev({ event: 'Notification' }), 10);
    expect(lastWorker(m, 'editor')).toMatchObject({ state: 'waiting', anim: 'wait' });
  });

  it('session start shows idle', () => {
    const s = new CrewState(config({ fallback: 'developer' }));
    const m = s.apply(ev({ event: 'SessionStart' }), 0);
    expect(lastWorker(m, 'developer')).toMatchObject({ state: 'idle', sessions: 1 });
  });

  it('subagent stop changes nothing but logs', () => {
    const s = new CrewState(config());
    s.apply(ev({ skill: 'b1kjuu-editor' }), 0);
    const m = s.apply(ev({ event: 'SubagentStop' }), 10);
    expect(workers(m)).toEqual([]);
    expect(m.filter((x) => x.type === 'log')).toHaveLength(1);
  });

  it('silent session dropped after 10 min', () => {
    const s = new CrewState(config());
    s.apply(ev({ session: 'ed', skill: 'b1kjuu-editor' }), 0);
    s.apply(ev({ session: 'gen-xxx', tool: 'Read' }), 0);
    const m = s.tick(SESSION_TIMEOUT_MS);
    expect(lastWorker(m, 'editor')).toMatchObject({ state: 'away', sessions: 0 });
    expect(m).toContainEqual({ type: 'remove', id: 'session-gen-xx' });
  });

  it('log keeps the last 200', () => {
    const s = new CrewState(config());
    for (let i = 0; i < LOG_SIZE + 5; i++) s.apply(ev({ tool: 'Read' }), i);
    const log = s.snapshot(null).log;
    expect(log).toHaveLength(LOG_SIZE);
    expect(log[0]?.t).toBe(5);
  });

  it('log entries carry worker, event, tool and label', () => {
    const s = new CrewState(config());
    const m = s.apply(ev({ tool: 'mcp__capcut__capcut_save' }), 7);
    expect(m.find((x) => x.type === 'log')).toEqual({
      type: 'log',
      entry: { t: 7, worker: 'editor', event: 'PreToolUse', tool: 'mcp__capcut__capcut_save', label: 'editing' },
    });
  });

  it('only changed workers are emitted', () => {
    const s = new CrewState(config());
    s.apply(ev({ skill: 'b1kjuu-editor' }), 0);
    s.apply(ev({ tool: 'Bash' }), 1);
    expect(workers(s.apply(ev({ tool: 'Bash' }), 2))).toEqual([]);
  });

  it('setConfig keeps live sessions', () => {
    const s = new CrewState(config());
    s.apply(ev({ skill: 'b1kjuu-editor' }), 0);
    s.setConfig(config({ office: { name: 'Renamed', setting: 'crew-deck' } }));
    const snap = s.snapshot(null);
    expect(snap.office.name).toBe('Renamed');
    expect(snap.workers.find((w) => w.id === 'editor')).toMatchObject({ state: 'working', sessions: 1 });
  });

  it('setConfig moves sessions of a removed worker to the fallback', () => {
    const s = new CrewState(config({ fallback: 'developer' }));
    s.apply(ev({ skill: 'b1kjuu-editor' }), 0);
    const cfg = config({ fallback: 'developer', rules: [] });
    cfg.workers = cfg.workers.filter((w) => w.id !== 'editor');
    s.setConfig(cfg);
    expect(s.snapshot(null).workers.find((w) => w.id === 'developer')).toMatchObject({ sessions: 1 });
  });

  it('sessions of a removed worker each get their own crewmember with per-session fallback', () => {
    const s = new CrewState(config());
    s.apply(ev({ session: 'aaaaaa-1', skill: 'b1kjuu-editor' }), 0);
    s.apply(ev({ session: 'bbbbbb-2', skill: 'b1kjuu-editor' }), 1);
    const cfg = config({ rules: [] });
    cfg.workers = cfg.workers.filter((w) => w.id !== 'editor');
    s.setConfig(cfg);
    const generics = s.snapshot(null).workers.filter((w) => w.generic);
    expect(generics.map((w) => w.sessions)).toEqual([1, 1]);
  });

  it('moving crew off a taken console never lands two on one console', () => {
    const s = new CrewState(config());
    s.apply(ev({ session: 'gen-1', tool: 'Read' }), 0); // console-3
    s.apply(ev({ session: 'gen-2', tool: 'Read' }), 1); // console-4
    const cfg = config();
    cfg.workers = [...cfg.workers, { id: 'writer', name: 'Writer', sprite: 'crew-3', color: '#5fd08a', home: 'console-3' }];
    s.setConfig(cfg);
    const homes = s.snapshot(null).workers.map((w) => w.home);
    expect(new Set(homes).size).toBe(homes.length);
  });

  it('a config reload moves crew off a console a new worker now owns', () => {
    const s = new CrewState(config());
    s.apply(ev({ session: 'gen-1', tool: 'Read' }), 0);
    expect(s.snapshot(null).workers.find((w) => w.generic)?.home).toBe('console-3');
    const cfg = config();
    cfg.workers = [...cfg.workers, { id: 'writer', name: 'Writer', sprite: 'crew-3', color: '#5fd08a', home: 'console-3' }];
    s.setConfig(cfg);
    expect(s.snapshot(null).workers.find((w) => w.generic)?.home).toBe('console-4');
  });
});
