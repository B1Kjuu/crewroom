import type { Rule } from '../shared/config-schema.js';
import type { AnyEvent, Anim } from '../shared/events.js';

const escape = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
const slashes = (s: string) => s.replace(/\\/g, '/');
const isAbsolute = (p: string) => p.startsWith('/') || /^[a-z]:\//i.test(p);

const cache = new Map<string, RegExp>();

/** name: * = anything, case-sensitive. text: same, case-insensitive. path: ** crosses folders, * does not. */
export function globToRegExp(pattern: string, kind: 'name' | 'text' | 'path'): RegExp {
  const key = kind + '\0' + pattern;
  const hit = cache.get(key);
  if (hit) return hit;

  let re: RegExp;
  if (kind !== 'path') {
    re = new RegExp('^' + pattern.split('*').map(escape).join('.*') + '$', kind === 'text' ? 'is' : '');
  } else {
    const p = slashes(pattern);
    const body = p
      .split('**')
      .map((part) => part.split('*').map(escape).join('[^/]*'))
      .join('.*');
    re = new RegExp((isAbsolute(p) ? '^' : '(?:^|/)') + body + '$', 'i');
  }
  cache.set(key, re);
  return re;
}

type WhenKey = keyof Rule['when'];

const hook = <K extends 'skill' | 'tool' | 'command' | 'cwd'>(ev: AnyEvent, k: K) => (ev.event === 'Report' ? undefined : ev[k]);

const fieldOf: Record<WhenKey, (ev: AnyEvent) => string | undefined> = {
  skill: (ev) => hook(ev, 'skill'),
  tool: (ev) => hook(ev, 'tool'),
  command: (ev) => hook(ev, 'command')?.trimStart(),
  path: (ev) => (ev.path === undefined ? undefined : slashes(ev.path)),
  cwd: (ev) => {
    const c = hook(ev, 'cwd');
    return c === undefined ? undefined : slashes(c);
  },
  source: (ev) => (ev.event === 'Report' ? ev.source : 'claude'),
  text: (ev) => (ev.event === 'Report' ? ev.text : undefined),
};

const kindOf = (k: WhenKey): 'name' | 'text' | 'path' => (k === 'path' || k === 'cwd' ? 'path' : k === 'text' ? 'text' : 'name');

function keyMatches(key: WhenKey, value: string | readonly string[], ev: AnyEvent): boolean {
  const field = fieldOf[key](ev);
  if (field === undefined) return false;
  const patterns = typeof value === 'string' ? [value] : value;
  return patterns.some((p) => globToRegExp(p, kindOf(key)).test(field));
}

export function matchRule(rules: Rule[], ev: AnyEvent): { worker: string; action?: string } | null {
  for (const rule of rules) {
    const entries = Object.entries(rule.when) as [WhenKey, string | string[] | undefined][];
    const ok = entries.every(([k, v]) => v === undefined || keyMatches(k, v, ev));
    if (ok) return rule.action ? { worker: rule.worker, action: rule.action } : { worker: rule.worker };
  }
  return null;
}

const TOOL_ANIM: Record<string, Anim> = {
  Read: 'read',
  Grep: 'read',
  Glob: 'read',
  WebFetch: 'read',
  Edit: 'type',
  Write: 'type',
  NotebookEdit: 'type',
  Bash: 'run',
  Agent: 'think',
  Task: 'think',
};

export function defaultAnim(ev: AnyEvent): Anim {
  if (ev.event === 'Report') return ev.status === 'waiting' ? 'wait' : 'type';
  if (ev.event === 'UserPromptSubmit') return 'think';
  if (ev.event === 'Notification') return 'wait';
  return (ev.tool && TOOL_ANIM[ev.tool]) || 'type';
}
