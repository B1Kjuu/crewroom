// Claude Code hook for crewroom. Runs on every hook event, so it must be fast and
// silent: only node: built-ins, nothing on stdout/stderr, always exit 0.
import { request } from 'node:http';
import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CrewEvent, HookEventName } from '../shared/events.js';

const EVENTS: readonly string[] = [
  'SessionStart',
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'Notification',
  'Stop',
  'SubagentStop',
  'SessionEnd',
];

const str = (v: unknown, max = 1000): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;

export function trimEvent(raw: unknown): CrewEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const event = r.hook_event_name;
  const session = str(r.session_id);
  if (typeof event !== 'string' || !EVENTS.includes(event) || !session) return null;

  const out: CrewEvent = { event: event as HookEventName, session };
  const cwd = str(r.cwd);
  const tool = str(r.tool_name);
  if (cwd) out.cwd = cwd;
  if (tool) out.tool = tool;

  const input = r.tool_input && typeof r.tool_input === 'object' ? (r.tool_input as Record<string, unknown>) : {};
  const skill = str(input.skill);
  const command = str(input.command, 200);
  const path = str(input.file_path) ?? str(input.path) ?? str(input.notebook_path);
  if (skill) out.skill = skill;
  if (command) out.command = command;
  if (path) out.path = path;
  return out;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export async function runHook(stdinText: string, opts: { home: string; timeoutMs?: number }): Promise<void> {
  try {
    const ev = trimEvent(JSON.parse(stdinText));
    if (!ev) return;
    const info = JSON.parse(await readFile(join(opts.home, 'bridge.json'), 'utf8')) as { port?: unknown; token?: unknown; pid?: unknown };
    if (typeof info.port !== 'number' || typeof info.token !== 'string') return;
    // A killed bridge leaves bridge.json behind; never hand events to whatever owns that port now.
    if (typeof info.pid === 'number' && !alive(info.pid)) return;
    const body = JSON.stringify(ev);

    await new Promise<void>((done) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: info.port as number,
          method: 'POST',
          path: '/events',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(body),
            'x-crewroom-token': info.token as string,
          },
        },
        (res) => {
          res.resume();
          res.on('end', done);
          res.on('error', done);
        },
      );
      const timer = setTimeout(() => {
        req.destroy();
        done();
      }, opts.timeoutMs ?? 150);
      req.on('error', () => done());
      req.on('close', () => clearTimeout(timer));
      req.end(body);
    });
  } catch {
    // bridge not running, bad input: never matters to Claude Code
  }
}

function readStdin(ms: number): Promise<string> {
  return new Promise((done) => {
    let data = '';
    const timer = setTimeout(() => done(data), ms);
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c: string) => (data += c));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      done(data);
    });
    process.stdin.on('error', () => done(data));
  });
}

async function main(): Promise<void> {
  const start = Date.now();
  const budget = 150;
  const home = process.env.CREWROOM_HOME || join(homedir(), '.crewroom');
  const text = await readStdin(budget);
  await runHook(text, { home, timeoutMs: Math.max(20, budget - (Date.now() - start)) });
}

// Node resolves import.meta.url through junctions and symlinks; argv[1] is not. Compare real paths.
function isEntry(): boolean {
  try {
    const entry = process.argv[1];
    return !!entry && realpathSync(resolve(entry)) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) {
  process.on('uncaughtException', () => process.exit(0));
  main().finally(() => process.exit(0));
}
