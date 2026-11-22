import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { parseConfig } from '../shared/config-schema.js';
import { z } from 'zod';
import { crewEventSchema, REPORT_STATUSES, reportEventSchema, type AnyEvent, type ServerMsg, type SnapshotMsg } from '../shared/events.js';
import { hostAllowed, newToken, originAllowed, tokenMatches } from './auth.js';
import { watchConfig } from './config.js';
import { startSources } from './sources/index.js';
import { CrewState } from './state.js';
import { validateLayout } from '../shared/layout.js';
import { expandHome } from '../shared/paths.js';

/** A saved layout file: { rows: [...] } or a bare list of rows. Its rows may still have problems. */
function looksLikeLayout(text: string): boolean {
  try {
    const raw = JSON.parse(text) as unknown;
    const rows = Array.isArray(raw) ? raw : (raw as { rows?: unknown } | null)?.rows;
    return Array.isArray(rows) && rows.every((r) => typeof r === 'string');
  } catch {
    return false;
  }
}

const webhookBodySchema = z.strictObject({
  worker: z.string().min(1).max(60).optional(),
  status: z.enum(REPORT_STATUSES).default('note'),
  text: z.string().max(200).optional(),
  session: z.string().min(1).max(100).optional(),
});

export class BridgeError extends Error {
  constructor(
    readonly code: 'PORT_IN_USE' | 'CONFIG_INVALID' | 'CONFIG_MISSING' | 'ALREADY_RUNNING',
    message: string,
  ) {
    super(message);
  }
}

export interface BridgeOptions {
  port: number;
  configPath: string;
  home: string;
  officeDir: string;
}

const MAX_BODY = 65536;
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

/** Every bridge response carries this, so a probe can tell crewroom from another app on the port. */
const BRIDGE_HEADER = 'x-crewroom';

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** The port of a bridge that bridge.json names, whose process is alive and that answers as crewroom; else null. */
async function runningBridge(file: string): Promise<number | null> {
  let info: { port?: unknown; pid?: unknown };
  try {
    info = JSON.parse(await readFile(file, 'utf8')) as typeof info;
  } catch {
    return null;
  }
  const { port, pid } = info;
  if (typeof port !== 'number' || port < 1 || port > 65535) return null;
  if (typeof pid === 'number' && !alive(pid)) return null; // left behind by a crewroom that was killed
  return new Promise((done) => {
    const req = request({ host: '127.0.0.1', port, path: '/', headers: { host: `127.0.0.1:${port}` }, timeout: 300 }, (res) => {
      res.resume();
      done(res.headers[BRIDGE_HEADER] ? (port as number) : null);
    });
    req.on('timeout', () => {
      req.destroy();
      done(null);
    });
    req.on('error', () => done(null));
    req.end();
  });
}

export async function startBridge(opts: BridgeOptions): Promise<{ port: number; token: string; close(): Promise<void> }> {
  let text: string;
  try {
    text = await readFile(opts.configPath, 'utf8');
  } catch {
    throw new BridgeError('CONFIG_MISSING', `No config at ${opts.configPath}`);
  }
  const parsed = parseConfig(text);
  if (!parsed.ok) throw new BridgeError('CONFIG_INVALID', `Config at ${opts.configPath} is invalid:\n${parsed.error}`);

  // One bridge per home: a second one would take over bridge.json and the first would go quiet.
  const running = await runningBridge(join(opts.home, 'bridge.json'));
  if (running) throw new BridgeError('ALREADY_RUNNING', `crewroom is already running at http://127.0.0.1:${running}`);

  const token = newToken();
  let current = parsed.config;
  const state = new CrewState(parsed.config);
  let configError: string | null = null;
  let port = opts.port;
  const clients = new Set<WebSocket>();
  const officeRoot = resolve(opts.officeDir);

  const broadcast = (msgs: ServerMsg[]) => {
    for (const m of msgs) {
      const data = JSON.stringify(m);
      for (const c of clients) c.send(data);
    }
  };

  const apply = (ev: AnyEvent) => broadcast(state.apply(ev, Date.now()));

  // Layout: config.layout, else ~/.crewroom/layout.json if saved from the editor, else the built-in deck.
  let layoutRows: string[] | null = null;
  let layoutError: string | null = null;
  // A relative "layout" is next to the config file, not wherever crewroom was started.
  const layoutPath = () =>
    current.layout ? resolve(dirname(resolve(opts.configPath)), expandHome(current.layout)) : join(opts.home, 'layout.json');
  const readLayout = async (): Promise<{ rows: string[] | null; error: string | null }> => {
    const path = layoutPath();
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
      const missing = (e as NodeJS.ErrnoException).code === 'ENOENT';
      return { rows: null, error: !missing || current.layout ? `Layout ${path} can't be read; using the built-in deck.` : null };
    }
    const rows = Array.isArray(raw) ? raw : (raw as { rows?: unknown } | null)?.rows;
    const errors = validateLayout(rows);
    if (errors.length) return { rows: null, error: `Layout ${path} has problems, so the built-in deck is shown:\n${errors.join('\n')}` };
    return { rows: rows as string[], error: null };
  };
  // Swap in the result only once it's read, so a client connecting mid-read never sees the built-in deck by mistake.
  const loadLayout = async () => {
    const next = await readLayout();
    layoutRows = next.rows;
    layoutError = next.error;
  };
  await loadLayout();

  const snap = (): SnapshotMsg => ({
    ...state.snapshot([configError, layoutError].filter(Boolean).join('\n') || null),
    layout: layoutRows,
  });

  /** Token check, size limit and JSON parse shared by every POST. */
  const readBody = (req: IncomingMessage, res: ServerResponse, onBody: (body: unknown) => void) => {
    if (!tokenMatches(req.headers['x-crewroom-token'] as string | undefined, token)) {
      res.writeHead(401).end();
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) tooBig = true;
      else chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return void res.writeHead(413).end();
      let body: unknown;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return void res.writeHead(400).end();
      }
      onBody(body);
    });
  };

  const readJson = (req: IncomingMessage, res: ServerResponse, toEvent: (body: unknown) => AnyEvent | null) =>
    readBody(req, res, (body) => {
      const ev = toEvent(body);
      if (!ev) return void res.writeHead(400).end();
      res.writeHead(204).end();
      setImmediate(() => apply(ev));
    });

  const saveLayout = (req: IncomingMessage, res: ServerResponse) =>
    readBody(req, res, async (body) => {
      const fail = (errors: string[]) => res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ errors }));
      if (!body || typeof body !== 'object' || !('rows' in body)) return fail(['Send { "rows": [...] }.']);
      const rows = (body as { rows: unknown }).rows;
      const path = layoutPath();
      try {
        if (rows === null) {
          if (current.layout) return fail(['Your config sets "layout"; edit that file or remove the setting.']);
          await rm(path, { force: true });
        } else {
          const errors = validateLayout(rows);
          if (errors.length) return fail(errors);
          // Never overwrite something that isn't a layout (e.g. "layout" pointed at the config by mistake).
          let existing: string | null = null;
          try {
            existing = await readFile(path, 'utf8');
          } catch {
            // nothing there yet
          }
          if (existing !== null && !looksLikeLayout(existing)) {
            return fail([`${path} isn't a crewroom layout, so it wasn't overwritten. Point "layout" at a new file.`]);
          }
          await mkdir(dirname(path), { recursive: true });
          const tmp = `${path}.tmp`;
          await writeFile(tmp, JSON.stringify({ setting: 'crew-deck', rows }, null, 2) + '\n');
          await rename(tmp, path);
        }
      } catch (e) {
        return fail([`Couldn't save ${path}: ${(e as Error).message}`]);
      }
      await loadLayout();
      res.writeHead(204).end();
      broadcast([snap()]);
    });

  const hookEvent = (body: unknown): AnyEvent | null => {
    const r = crewEventSchema.safeParse(body);
    return r.success ? r.data : null;
  };

  const webhookEvent = (body: unknown): AnyEvent | null => {
    const r = webhookBodySchema.safeParse(body);
    if (!r.success) return null;
    const { worker, status, text, session } = r.data;
    const ev = reportEventSchema.safeParse({
      event: 'Report',
      session: `webhook:${session ?? worker?.toLowerCase() ?? 'anon'}`,
      source: 'webhook',
      worker,
      status,
      text,
    });
    return ev.success ? ev.data : null;
  };

  const serveStatic = async (req: IncomingMessage, res: ServerResponse) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    } catch {
      return void res.writeHead(400).end();
    }
    if (pathname.includes('..') || pathname.includes('\0')) return void res.writeHead(404).end();
    // Custom crew sheets: only lowercase names, only .png, only from ~/.crewroom/sprites.
    const sprite = /^\/sprites\/([a-z0-9-]{1,30})\.png$/.exec(pathname);
    if (sprite) {
      try {
        const png = await readFile(join(opts.home, 'sprites', `${sprite[1]}.png`));
        return void res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(png);
      } catch {
        return void res.writeHead(404).end();
      }
    }
    const file = resolve(officeRoot, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(officeRoot + sep)) return void res.writeHead(404).end();
    let data: Buffer;
    try {
      data = await readFile(file);
    } catch {
      return void res.writeHead(404).end();
    }
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    let out: Buffer | string = data;
    if (extname(file) === '.html') {
      out = data.toString('utf8').replace('</head>', `<meta name="crewroom-token" content="${token}"></head>`);
    }
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(out);
  };

  const server = createServer((req, res) => {
    res.setHeader(BRIDGE_HEADER, '1');
    if (!hostAllowed(req.headers.host, port)) {
      res.writeHead(403).end();
      req.resume();
      return;
    }
    if (req.method === 'POST' && req.url === '/events') return readJson(req, res, hookEvent);
    if (req.method === 'POST' && req.url === '/report') {
      if (!current.sources.webhook.enabled) {
        res.writeHead(404).end();
        req.resume();
        return;
      }
      return readJson(req, res, webhookEvent);
    }
    if (req.method === 'POST' && req.url === '/layout') return saveLayout(req, res);
    if (req.method === 'GET') return void serveStatic(req, res);
    res.writeHead(405).end();
    req.resume();
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://x');
    if (url.pathname !== '/live' || !hostAllowed(req.headers.host, port) || !originAllowed(req.headers.origin, port)) {
      socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      if (!tokenMatches(url.searchParams.get('token') ?? undefined, token)) {
        ws.close(4001, 'stale token');
        return;
      }
      clients.add(ws);
      ws.on('close', () => clients.delete(ws));
      ws.on('error', () => clients.delete(ws));
      ws.send(JSON.stringify(snap()));
    });
  });

  await new Promise<void>((ok, fail) => {
    server.once('error', (e: NodeJS.ErrnoException) => {
      fail(e.code === 'EADDRINUSE' ? new BridgeError('PORT_IN_USE', `Port ${opts.port} is busy`) : e);
    });
    server.listen(opts.port, '127.0.0.1', () => ok());
  });
  port = (server.address() as AddressInfo).port;

  const bridgeJson = join(opts.home, 'bridge.json');
  await mkdir(opts.home, { recursive: true });
  await writeFile(bridgeJson, JSON.stringify({ port, token, pid: process.pid }), { mode: 0o600 });

  const timer = setInterval(() => broadcast(state.tick(Date.now())), 1000);
  timer.unref();

  const sinks = { emit: apply, notice: (source: string, label: string) => broadcast(state.notice(source, label, Date.now())) };
  let sourcesKey = JSON.stringify(current.sources);
  let stopSources = startSources(current.sources, opts.home, sinks);

  const unwatch = watchConfig(opts.configPath, async (r) => {
    if (r.ok) {
      current = r.config;
      state.setConfig(r.config);
      configError = null;
      const key = JSON.stringify(r.config.sources);
      if (key !== sourcesKey) {
        sourcesKey = key;
        stopSources();
        stopSources = startSources(r.config.sources, opts.home, sinks);
      }
      await loadLayout(); // the config may point at a different layout now
    } else {
      configError = r.error;
    }
    broadcast([snap()]);
  });

  return {
    port,
    token,
    async close() {
      clearInterval(timer);
      unwatch();
      stopSources();
      for (const c of clients) c.terminate();
      wss.close();
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      try {
        const current = JSON.parse(await readFile(bridgeJson, 'utf8')) as { token?: string };
        if (current.token === token) await rm(bridgeJson, { force: true });
      } catch {
        // already gone
      }
    },
  };
}
