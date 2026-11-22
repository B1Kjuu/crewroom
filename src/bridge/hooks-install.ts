import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOOK_EVENTS, type HookEventName } from '../shared/events.js';

type Settings = Record<string, unknown>;
interface HookCmd { type?: unknown; command?: unknown }
interface Entry { matcher?: unknown; hooks?: unknown }

const fwd = (p: string) => p.replace(/\\/g, '/');

export function hookCommand(home: string): string {
  return `node "${fwd(home)}/hook.mjs"`;
}

export function isOurs(cmd: unknown, home?: string): boolean {
  if (typeof cmd !== 'string') return false;
  const c = fwd(cmd);
  return c.endsWith('/.crewroom/hook.mjs"') || (home !== undefined && c.endsWith(`${fwd(home)}/hook.mjs"`));
}

const entryIsOurs = (e: Entry, home?: string) =>
  Array.isArray(e?.hooks) && (e.hooks as HookCmd[]).some((h) => isOurs(h?.command, home));

function hooksOf(settings: Settings): Record<string, unknown> {
  const h = settings.hooks ?? {};
  if (typeof h !== 'object' || h === null || Array.isArray(h)) throw new Error('"hooks" in settings.json is not an object; fix it first, nothing was changed');
  return h as Record<string, unknown>;
}

function listOf(hooks: Record<string, unknown>, ev: string): Entry[] {
  const list = hooks[ev] ?? [];
  if (!Array.isArray(list)) throw new Error(`"hooks.${ev}" in settings.json is not a list; fix it first, nothing was changed`);
  return list as Entry[];
}

export function planInstall(settings: Settings, cmd: string, home?: string): { next: Settings; added: HookEventName[] } {
  const next = structuredClone(settings);
  const hooks = hooksOf(next);
  const added: HookEventName[] = [];
  for (const ev of HOOK_EVENTS) {
    const list = listOf(hooks, ev);
    if (list.some((e) => entryIsOurs(e, home))) continue;
    hooks[ev] = [...list, { matcher: '', hooks: [{ type: 'command', command: cmd, timeout: 2 }] }];
    added.push(ev);
  }
  if (added.length) next.hooks = hooks;
  return { next, added };
}

export function planUninstall(settings: Settings, home?: string): { next: Settings; removed: HookEventName[] } {
  const next = structuredClone(settings);
  if (next.hooks === undefined) return { next, removed: [] };
  const hooks = hooksOf(next);
  const removed: HookEventName[] = [];
  for (const ev of HOOK_EVENTS) {
    if (hooks[ev] === undefined) continue;
    const list = listOf(hooks, ev);
    if (!list.some((e) => entryIsOurs(e, home))) continue;
    const kept = list
      .map((e) => (Array.isArray(e?.hooks) ? { ...e, hooks: (e.hooks as HookCmd[]).filter((h) => !isOurs(h?.command, home)) } : e))
      .filter((e) => !Array.isArray(e.hooks) || (e.hooks as unknown[]).length > 0);
    if (kept.length) hooks[ev] = kept;
    else delete hooks[ev];
    removed.push(ev);
  }
  if (Object.keys(hooks).length === 0) delete next.hooks;
  return { next, removed };
}

function readSettings(path: string): { settings: Settings; existed: boolean } {
  if (!existsSync(path)) return { settings: {}, existed: false };
  const text = readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (e) {
    throw new Error(`${path} is not valid JSON (${(e as Error).message}). Fix it first; nothing was changed.`, { cause: e });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} is not a JSON object. Fix it first; nothing was changed.`);
  }
  return { settings: parsed as Settings, existed: true };
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function backup(path: string): void {
  let target = `${path}.crewroom-backup-${stamp()}`;
  for (let i = 2; existsSync(target); i++) target = `${path}.crewroom-backup-${stamp()}-${i}`;
  copyFileSync(path, target);
}

// Claude Code reads settings.json while it runs: write a temp file and rename it over,
// so it never sees a half-written file.
function write(path: string, settings: Settings): void {
  const tmp = `${path}.crewroom-tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
  renameSync(tmp, path);
}

interface Confirm {
  yes: boolean;
  confirm: (summary: string) => Promise<boolean>;
}

export async function installHooks(opts: Confirm & { claudeDir: string; home: string; hookSource: string }): Promise<'installed' | 'unchanged' | 'cancelled'> {
  const path = join(opts.claudeDir, 'settings.json');
  const { settings, existed } = readSettings(path);
  const { next, added } = planInstall(settings, hookCommand(opts.home), opts.home);

  const copyHook = () => {
    mkdirSync(opts.home, { recursive: true });
    copyFileSync(opts.hookSource, join(opts.home, 'hook.mjs'));
  };
  if (added.length === 0) {
    copyHook(); // refresh the script to this version
    return 'unchanged';
  }

  const summary =
    `crewroom will add its hook to ${path} for: ${added.join(', ')}.\n` +
    `Your other hooks stay as they are${existed ? ', and a backup is saved first' : ''}.`;
  if (!opts.yes && !(await opts.confirm(summary))) return 'cancelled';

  copyHook();
  if (existed) backup(path);
  mkdirSync(opts.claudeDir, { recursive: true });
  write(path, next);
  return 'installed';
}

export async function uninstallHooks(opts: Confirm & { claudeDir: string; home?: string }): Promise<'removed' | 'unchanged' | 'cancelled'> {
  const path = join(opts.claudeDir, 'settings.json');
  const { settings, existed } = readSettings(path);
  if (!existed) return 'unchanged';
  const { next, removed } = planUninstall(settings, opts.home);
  if (removed.length === 0) return 'unchanged';
  const summary = `crewroom will remove its hook from ${path} for: ${removed.join(', ')}.\nYour other hooks stay, and a backup is saved first.`;
  if (!opts.yes && !(await opts.confirm(summary))) return 'cancelled';
  backup(path);
  write(path, next);
  return 'removed';
}

export function hooksStatus(claudeDir: string, home: string): { installed: HookEventName[]; missing: HookEventName[] } {
  const { settings } = readSettings(join(claudeDir, 'settings.json'));
  const hooks = hooksOf(settings);
  const installed: HookEventName[] = [];
  const missing: HookEventName[] = [];
  for (const ev of HOOK_EVENTS) {
    (listOf(hooks, ev).some((e) => entryIsOurs(e, home)) ? installed : missing).push(ev);
  }
  return { installed, missing };
}
