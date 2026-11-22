import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { BridgeError, startBridge } from './bridge/server.js';
import { hooksStatus, installHooks, uninstallHooks } from './bridge/hooks-install.js';
import { parseConfig, type OfficeConfig } from './shared/config-schema.js';
import { initCommand } from './init/init.js';
import { REPORT_STATUSES } from './shared/events.js';
import { crewroomHome, defaultConfigPath, expandHome } from './shared/paths.js';

export const DEFAULT_PORT = 47321;

export const STARTER_CONFIG: OfficeConfig = {
  office: { name: 'crewroom', setting: 'crew-deck' },
  workers: [{ id: 'crew', name: 'Crew', sprite: 'crew-1', color: '#e8452c', home: 'console-1' }],
  rules: [],
  fallback: 'per-session',
  actions: {},
  layout: null,
  sources: { inbox: { enabled: true, path: null }, log: [], webhook: { enabled: true } },
};

const USAGE = `Usage: crewroom <command>

  init [--preset NAME] [--yes] [--hook] [--config PATH] [--skills-dir DIR]   set up your crew
  start [--port N] [--config PATH] [--no-open]   start the bridge and open the office
  hooks install [--yes]                          add crewroom's hook to Claude Code
  hooks uninstall [--yes]                        remove only crewroom's hook
  hooks status                                   show which hook events are installed
  config check [PATH]                            check a config file
  report <worker> [start|done|note|waiting] <text>   tell the deck what a worker is doing`;

/** Writes one inbox file. Works with the bridge stopped: it reads the file when it starts. */
function report(argv: string[]): number {
  const [worker, maybeStatus, ...rest] = argv;
  const isStatus = (REPORT_STATUSES as readonly string[]).includes((maybeStatus ?? '').toLowerCase());
  const status = isStatus ? maybeStatus!.toLowerCase() : 'note';
  const text = (isStatus ? rest : [maybeStatus, ...rest]).filter((w): w is string => !!w).join(' ').trim();
  if (!worker || !text) {
    console.error(USAGE);
    return 1;
  }
  let dir = join(crewroomHome(), 'inbox');
  try {
    const r = parseConfig(readFileSync(defaultConfigPath(), 'utf8'));
    if (r.ok && r.config.sources.inbox.path) dir = expandHome(r.config.sources.inbox.path);
  } catch {
    // no config yet: the default inbox is right
  }
  mkdirSync(dir, { recursive: true });
  const line = `${worker} ${status}: ${text.replace(/\s+/g, ' ').slice(0, 200)}`;
  writeFileSync(join(dir, `${Date.now()}-${randomBytes(3).toString('hex')}.txt`), line + '\n');
  console.log(`Reported: ${line}`);
  return 0;
}

const here = dirname(fileURLToPath(import.meta.url));
const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  const child = spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

async function ask(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question}\nContinue? [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

export async function startCommand(opts: { port: number; configPath: string; open: boolean; officeDir?: string }) {
  if (!existsSync(opts.configPath)) {
    mkdirSync(dirname(opts.configPath), { recursive: true });
    writeFileSync(opts.configPath, JSON.stringify(STARTER_CONFIG, null, 2) + '\n');
    console.log(`Created a starter config at ${opts.configPath}`);
  }
  const bridge = await startBridge({
    port: opts.port,
    configPath: opts.configPath,
    home: crewroomHome(),
    officeDir: opts.officeDir ?? join(here, 'office'),
  });
  const url = `http://127.0.0.1:${bridge.port}`;
  console.log(`crewroom running at ${url}`);
  console.log(`Config: ${opts.configPath}  (Ctrl+C to stop)`);
  if (opts.open) openBrowser(url);
  return bridge;
}

async function start(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { port: { type: 'string' }, config: { type: 'string' }, 'no-open': { type: 'boolean' } },
  });
  const port = values.port === undefined ? DEFAULT_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`--port must be a number from 0 to 65535`);
    return 1;
  }
  const configPath = resolve(values.config ?? defaultConfigPath());
  let bridge: Awaited<ReturnType<typeof startCommand>>;
  try {
    bridge = await startCommand({ port, configPath, open: !values['no-open'] });
  } catch (e) {
    if (e instanceof BridgeError) {
      console.error(e.code === 'PORT_IN_USE' ? `Port ${port} is busy. Is crewroom already running? Try --port.` : e.message);
      return 1;
    }
    throw e;
  }
  await new Promise<void>((done) => {
    process.once('SIGINT', done);
    process.once('SIGTERM', done);
  });
  await bridge.close();
  return 0;
}

async function init(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      preset: { type: 'string' },
      yes: { type: 'boolean' },
      hook: { type: 'boolean' },
      config: { type: 'string' },
      'skills-dir': { type: 'string', multiple: true },
    },
  });
  const yes = !!values.yes;
  // One line queue for every question. readline drops lines that arrive before a question is asked,
  // which loses piped answers ("printf '1\ny\n' | crewroom init"); end of input answers "".
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  let ended = false;
  rl.on('line', (line) => (waiting.length ? waiting.shift()!(line) : lines.push(line)));
  rl.on('close', () => {
    ended = true;
    while (waiting.length) waiting.shift()!('');
  });
  const question = (q: string) => {
    process.stdout.write(q);
    if (lines.length) return Promise.resolve(lines.shift()!);
    if (ended) return Promise.resolve('');
    return new Promise<string>((r) => waiting.push(r));
  };
  const confirm = async (summary: string) => /^y(es)?$/i.test((await question(`${summary}\nContinue? [y/N] `)).trim());
  try {
    return await initCommand({
      configPath: resolve(values.config ?? defaultConfigPath()),
      pluginsDir: join(claudeDir(), 'plugins'),
      skillsDirs: [join(claudeDir(), 'skills'), ...(values['skills-dir'] ?? []).map((d) => resolve(expandHome(d)))],
      preset: values.preset,
      yes,
      hook: !!values.hook,
      ask: question,
      print: (s) => console.log(s),
      installHooks: () =>
        installHooks({ claudeDir: claudeDir(), home: crewroomHome(), hookSource: join(here, 'hook', 'claude-hook.js'), yes, confirm }),
    });
  } finally {
    rl.close();
  }
}

async function hooks(argv: string[]): Promise<number> {
  const [sub, ...rest] = argv;
  const { values } = parseArgs({ args: rest, options: { yes: { type: 'boolean' } } });
  const home = crewroomHome();
  const confirm = { yes: !!values.yes, confirm: ask };
  try {
    if (sub === 'install') {
      const r = await installHooks({ claudeDir: claudeDir(), home, hookSource: join(here, 'hook', 'claude-hook.js'), ...confirm });
      console.log(
        { installed: 'Hook installed. New Claude Code sessions will report to crewroom.', unchanged: 'Hook already installed (script refreshed).', cancelled: 'Cancelled. Nothing was changed.' }[r],
      );
      return 0;
    }
    if (sub === 'uninstall') {
      const r = await uninstallHooks({ claudeDir: claudeDir(), home, ...confirm });
      console.log({ removed: 'Hook removed.', unchanged: 'Hook was not installed.', cancelled: 'Cancelled. Nothing was changed.' }[r]);
      return 0;
    }
    if (sub === 'status') {
      const s = hooksStatus(claudeDir(), home);
      console.log(`Installed: ${s.installed.join(', ') || 'none'}`);
      console.log(`Not installed: ${s.missing.join(', ') || 'none'}`);
      return 0;
    }
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
  console.error(USAGE);
  return 1;
}

function configCheck(argv: string[]): number {
  const path = resolve(argv[0] ?? defaultConfigPath());
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    console.error(`No config at ${path}`);
    return 1;
  }
  const r = parseConfig(text);
  if (r.ok) {
    console.log(`Config OK: ${path}`);
    return 0;
  }
  console.error(`Config at ${path} is invalid:\n${r.error}`);
  return 1;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  try {
    if (cmd === 'start') return await start(rest);
    if (cmd === 'hooks') return await hooks(rest);
    if (cmd === 'config' && rest[0] === 'check') return configCheck(rest.slice(1));
    if (cmd === 'report') return report(rest);
    if (cmd === 'init') return await init(rest);
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
  console.error(USAGE);
  return 1;
}
