import type { OfficeConfig } from '../shared/config-schema.js';
import type { Anim, AnyEvent, LogEntry, ReportEvent, ServerMsg, SnapshotMsg, WorkerState, WorkerView } from '../shared/events.js';
import { defaultAnim, matchRule } from './match.js';

export const IDLE_AFTER_STOP_MS = 4000;
export const SESSION_TIMEOUT_MS = 600_000;
/** Self-reported work can run long between reports (a Cowork task, a render). */
export const REPORT_TIMEOUT_MS = 1_800_000;
/** A one-off "note" shows the worker busy for this long. */
export const NOTE_MS = 60_000;
export const LOG_SIZE = 200;
const LABEL_MAX = 40;
const MAX_GENERICS = 12;

const CONSOLES = ['console-1', 'console-2', 'console-3', 'console-4', 'console-5', 'console-6', 'console-7', 'console-8'];
const GENERIC_COLOR = '#9aa4b2';

type Base = Pick<WorkerView, 'id' | 'name' | 'sprite' | 'color' | 'home' | 'generic'>;

interface Activity {
  state: WorkerState;
  action?: string;
  label?: string;
  anim?: Anim;
}

interface Session {
  worker: string;
  lastT: number;
  /** When set, the worker shows as idle from this time on (after Stop, done, or a note). */
  idleAt?: number;
  timeoutMs: number;
  /** Self-reported (inbox, log, webhook) rather than a Claude Code session. */
  report: boolean;
  activity: Activity;
}

export class CrewState {
  private config: OfficeConfig;
  private sessions = new Map<string, Session>();
  private generics = new Map<string, Base>();
  private genericCount = 0;
  private log: LogEntry[] = [];
  private emitted = new Map<string, string>();
  private now = 0;

  constructor(config: OfficeConfig) {
    this.config = config;
    this.seed();
  }

  setConfig(config: OfficeConfig): void {
    this.config = config;
    // Crew whose console a configured worker now owns move to a free one.
    const used = new Set<string>(config.workers.map((w) => w.home));
    for (const g of this.generics.values()) {
      if (used.has(g.home) || g.home === 'lounge') g.home = CONSOLES.find((c) => !used.has(c)) ?? 'lounge';
      used.add(g.home);
    }
    // Sessions of a removed worker fall back one by one (not all into one crewmember).
    for (const [key, s] of this.sessions) {
      if (!this.base(s.worker)) s.worker = this.fallbackFor(key, s.report ? key.slice(key.indexOf(':') + 1) : undefined);
    }
    this.seed();
  }

  private seed(): void {
    this.emitted.clear();
    for (const id of this.allIds()) this.emitted.set(id, JSON.stringify(this.view(id, this.now)));
  }

  apply(ev: AnyEvent, now: number): ServerMsg[] {
    const named = ev.event === 'Report' && ev.worker ? this.workerByName(ev.worker) : undefined;
    const match = matchRule(this.config.rules, ev);
    const chosen = named ?? match?.worker;
    // The vault log has lines from every session; only lines a rule claims are shown.
    if (ev.event === 'Report' && ev.source === 'log' && !chosen) return [];

    // Self-reported work is tracked per source and worker, so one log or inbox can drive several crew.
    const key = ev.event === 'Report' && chosen ? `${ev.source}:${chosen}` : ev.session;
    let s = this.sessions.get(key);
    if (!s) {
      s = {
        worker: chosen ?? this.fallbackFor(key, ev.event === 'Report' ? ev.worker : undefined),
        lastT: now,
        timeoutMs: ev.event === 'Report' ? REPORT_TIMEOUT_MS : SESSION_TIMEOUT_MS,
        report: ev.event === 'Report',
        activity: { state: 'idle' },
      };
      this.sessions.set(key, s);
    } else if (chosen) {
      s.worker = chosen;
    }
    s.lastT = now;
    this.now = Math.max(this.now, now);

    if (ev.event === 'Report') return this.applyReport(ev, s, match?.action, now);

    switch (ev.event) {
      case 'SessionStart':
        s.activity = { state: 'idle' };
        break;
      case 'SubagentStop':
        break;
      case 'Notification':
        s.idleAt = undefined;
        s.activity = { state: 'waiting', anim: 'wait', label: 'needs you' };
        break;
      case 'Stop':
        s.idleAt = now + IDLE_AFTER_STOP_MS;
        break;
      case 'SessionEnd':
        this.sessions.delete(key);
        break;
      default: {
        s.idleAt = undefined;
        const action = match?.action;
        const def = action ? this.config.actions[action] : undefined;
        const activity: Activity = {
          state: 'working',
          anim: def?.anim ?? defaultAnim(ev),
          label: def?.label ?? action ?? (ev.tool === 'Skill' ? ev.skill : undefined) ?? ev.tool ?? 'thinking',
        };
        if (action) activity.action = action;
        s.activity = activity;
      }
    }

    const entry: LogEntry = { t: now, worker: s.worker, event: ev.event };
    if (ev.tool) entry.tool = ev.tool;
    if (s.activity.label && ev.event !== 'SessionEnd' && ev.event !== 'Stop' && ev.event !== 'SubagentStop') {
      entry.label = s.activity.label;
    }
    return this.finish(entry, now);
  }

  private applyReport(ev: ReportEvent, s: Session, action: string | undefined, now: number): ServerMsg[] {
    const def = action ? this.config.actions[action] : undefined;
    const text = ev.text?.trim() ? ev.text.trim().slice(0, LABEL_MAX) : undefined;
    const label = def?.label ?? action ?? text;
    if (ev.status === 'waiting') {
      s.idleAt = undefined;
      s.activity = { state: 'waiting', anim: 'wait', label: label ?? 'needs you' };
    } else if (ev.status === 'done') {
      s.idleAt = now + IDLE_AFTER_STOP_MS;
    } else {
      const activity: Activity = { state: 'working', anim: def?.anim ?? defaultAnim(ev), label: label ?? 'working' };
      if (action) activity.action = action;
      s.activity = activity;
      s.idleAt = ev.status === 'note' ? now + NOTE_MS : undefined;
    }
    const entry: LogEntry = { t: now, worker: s.worker, event: 'Report' };
    const shown = label ?? (ev.status === 'done' ? 'done' : undefined);
    if (shown) entry.label = shown;
    return this.finish(entry, now);
  }

  /** A line for the activity log that moves no one, e.g. an inbox file that couldn't be read. */
  notice(source: string, label: string, now: number): ServerMsg[] {
    this.now = Math.max(this.now, now);
    return this.finish({ t: now, worker: source, event: 'Report', label }, now);
  }

  private finish(entry: LogEntry, now: number): ServerMsg[] {
    this.log.push(entry);
    if (this.log.length > LOG_SIZE) this.log.splice(0, this.log.length - LOG_SIZE);
    return [...this.diff(now), { type: 'log', entry }];
  }

  private workerByName(name: string): string | undefined {
    const n = name.trim().toLowerCase();
    return this.config.workers.find((w) => w.id === n || w.name.toLowerCase() === n)?.id;
  }

  tick(now: number): ServerMsg[] {
    this.now = Math.max(this.now, now);
    for (const [id, s] of this.sessions) {
      if (now - s.lastT >= s.timeoutMs) this.sessions.delete(id);
    }
    return this.diff(now);
  }

  snapshot(configError: string | null): SnapshotMsg {
    const now = this.now;
    return {
      type: 'snapshot',
      office: { ...this.config.office },
      workers: this.allIds().map((id) => this.view(id, now)),
      log: [...this.log],
      configError,
    };
  }

  /** `name` is set for self-reported work from an unknown worker: it becomes the crewmember's name. */
  private fallbackFor(session: string, name?: string): string {
    if (this.config.fallback !== 'per-session') return this.config.fallback;
    let id = name
      ? 'session-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)
      : 'session-' + session.slice(0, 6);
    let label = name?.trim().slice(0, 20);
    if (!this.generics.has(id) && this.generics.size >= MAX_GENERICS - 1) {
      id = 'session-others'; // a flood of names shares one crewmember
      label = 'Others';
    }
    if (!this.generics.has(id)) {
      this.genericCount += 1;
      const n = this.genericCount;
      const used = new Set([...this.config.workers.map((w) => w.home), ...[...this.generics.values()].map((g) => g.home)]);
      this.generics.set(id, {
        id,
        name: label || `Crew ${n}`,
        sprite: `crew-${((n - 1) % 8) + 1}`,
        color: GENERIC_COLOR,
        home: CONSOLES.find((c) => !used.has(c)) ?? 'lounge',
        generic: true,
      });
    }
    return id;
  }

  private base(id: string): Base | undefined {
    const w = this.config.workers.find((x) => x.id === id);
    if (w) return { ...w, generic: false };
    return this.generics.get(id);
  }

  private allIds(): string[] {
    return [...this.config.workers.map((w) => w.id), ...this.generics.keys()];
  }

  private view(id: string, now: number): WorkerView {
    const base = this.base(id)!;
    // Show the most urgent session (waiting beats working beats idle), newest first within a rank.
    const idleNow = (s: Session) => s.idleAt !== undefined && now >= s.idleAt;
    const rank = (s: Session) => (idleNow(s) ? 0 : s.activity.state === 'waiting' ? 2 : s.activity.state === 'working' ? 1 : 0);
    let count = 0;
    let driver: Session | undefined;
    for (const s of this.sessions.values()) {
      if (s.worker !== id) continue;
      if (!(s.report && idleNow(s))) count += 1; // a finished report no longer counts toward ×N
      if (!driver || rank(s) > rank(driver) || (rank(s) === rank(driver) && s.lastT >= driver.lastT)) driver = s;
    }
    if (!driver) return { ...base, state: 'away', sessions: 0 };
    const activity: Activity = idleNow(driver) ? { state: 'idle' } : driver.activity;
    return { ...base, ...activity, sessions: count };
  }

  private diff(now: number): ServerMsg[] {
    const out: ServerMsg[] = [];
    for (const [id, g] of this.generics) {
      const live = [...this.sessions.values()].some((s) => s.worker === id);
      if (!live) {
        this.generics.delete(id);
        if (this.emitted.delete(g.id)) out.push({ type: 'remove', id });
      }
    }
    for (const id of this.allIds()) {
      const v = this.view(id, now);
      const key = JSON.stringify(v);
      if (this.emitted.get(id) !== key) {
        this.emitted.set(id, key);
        out.push({ type: 'worker', worker: v });
      }
    }
    return out;
  }
}
