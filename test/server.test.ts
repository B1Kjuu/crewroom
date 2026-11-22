import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { startBridge, BridgeError } from '../src/bridge/server.js';
import { http, postEvent, tempDir, testConfig, writeFixtures, wsClient } from './helpers.js';

type Bridge = Awaited<ReturnType<typeof startBridge>>;
const open: Bridge[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

async function boot() {
  const dir = tempDir();
  const f = writeFixtures(dir);
  const b = await startBridge({ port: 0, ...f });
  open.push(b);
  return { ...f, b };
}

const skillEvent = { event: 'PreToolUse', session: 's1', tool: 'Skill', skill: 'b1kjuu-editor' };

describe('bridge server', () => {
  it('writes bridge.json with port and token', async () => {
    const { b, home } = await boot();
    const file = JSON.parse(readFileSync(join(home, 'bridge.json'), 'utf8'));
    expect(file).toMatchObject({ port: b.port, token: b.token, pid: process.pid });
  });

  it('POST /events: 204 with token, 401 without, 403 bad host, 413 too big, 400 bad body', async () => {
    const { b } = await boot();
    expect((await postEvent(b.port, b.token, skillEvent)).status).toBe(204);
    expect((await postEvent(b.port, 'nope', skillEvent)).status).toBe(401);
    const badHost = await http(b.port, {
      method: 'POST', path: '/events', headers: { host: 'evil.com', 'x-crewroom-token': b.token }, body: JSON.stringify(skillEvent),
    });
    expect(badHost.status).toBe(403);
    expect((await postEvent(b.port, b.token, { ...skillEvent, path: 'x'.repeat(70000) })).status).toBe(413);
    expect((await postEvent(b.port, b.token, { event: 'Nope', session: 's1' })).status).toBe(400);
    const notJson = await http(b.port, { method: 'POST', path: '/events', headers: { 'x-crewroom-token': b.token }, body: '{' });
    expect(notJson.status).toBe(400);
  });

  it('ws receives a snapshot then a worker delta after a POST', async () => {
    const { b } = await boot();
    const c = wsClient(b.port, b.token);
    const snap = await c.waitFor((m) => m.type === 'snapshot');
    expect(snap).toMatchObject({ type: 'snapshot', office: { name: 'Test deck' }, configError: null });
    await postEvent(b.port, b.token, skillEvent);
    const w = await c.waitFor((m) => m.type === 'worker');
    expect(w).toMatchObject({ worker: { id: 'editor', state: 'working' } });
    c.ws.close();
  });

  it('ws with a stale token is closed with 4001', async () => {
    const { b } = await boot();
    const c = wsClient(b.port, 'stale');
    expect(await c.closed).toBe(4001);
  });

  it('ws upgrade from another origin is refused', async () => {
    const { b } = await boot();
    const c = wsClient(b.port, b.token, 'http://evil.com');
    const code = await c.closed;
    expect(code).not.toBe(1000);
    expect(c.msgs).toEqual([]);
  });

  it('serves index.html with the token meta and blocks traversal', async () => {
    const { b } = await boot();
    const page = await http(b.port, { path: '/' });
    expect(page.status).toBe(200);
    expect(page.body).toContain(`<meta name="crewroom-token" content="${b.token}">`);
    expect((await http(b.port, { path: '/../package.json' })).status).toBe(404);
    expect((await http(b.port, { path: '/%2e%2e/package.json' })).status).toBe(404);
    expect((await http(b.port, { path: '/', headers: { host: 'evil.com' } })).status).toBe(403);
  });

  it('a bad config edit keeps the last good config and reports the error, fixing it clears it', async () => {
    const { b, configPath } = await boot();
    const c = wsClient(b.port, b.token);
    await c.waitFor((m) => m.type === 'snapshot');
    writeFileSync(configPath, '{ broken');
    const bad = await c.waitFor((m) => m.type === 'snapshot' && m.configError !== null);
    expect(bad).toMatchObject({ office: { name: 'Test deck' } });
    writeFileSync(configPath, JSON.stringify({ ...testConfig, office: { name: 'Fixed', setting: 'crew-deck' } }));
    const good = await c.waitFor((m) => m.type === 'snapshot' && m.configError === null && m.office.name === 'Fixed');
    expect(good).toBeTruthy();
    c.ws.close();
  });

  it('a port taken by something else fails with PORT_IN_USE and leaves bridge.json alone', async () => {
    const { b, configPath, officeDir } = await boot();
    const otherHome = join(tempDir(), 'home');
    const err = await startBridge({ port: b.port, configPath, officeDir, home: otherHome }).catch((e) => e);
    expect(err).toBeInstanceOf(BridgeError);
    expect((err as BridgeError).code).toBe('PORT_IN_USE');
    expect(existsSync(join(otherHome, 'bridge.json'))).toBe(false);
  });

  it('a second crewroom for the same home refuses to start, even on another port, and the first keeps working', async () => {
    const { b, configPath, officeDir, home } = await boot();
    const before = readFileSync(join(home, 'bridge.json'), 'utf8');
    const err = await startBridge({ port: 0, configPath, officeDir, home }).catch((e) => e);
    expect((err as BridgeError).code).toBe('ALREADY_RUNNING');
    expect((err as BridgeError).message).toContain(String(b.port));
    expect(readFileSync(join(home, 'bridge.json'), 'utf8')).toBe(before);
  });

  it('a bridge.json left by a crewroom that is gone does not block a new start', async () => {
    const dir = tempDir();
    const f = writeFixtures(dir);
    mkdirSync(f.home, { recursive: true });
    writeFileSync(join(f.home, 'bridge.json'), JSON.stringify({ port: 1, token: 'x', pid: 1 }));
    const b = await startBridge({ port: 0, ...f });
    open.push(b);
    expect(JSON.parse(readFileSync(join(f.home, 'bridge.json'), 'utf8')).port).toBe(b.port);
  });

  it('another app now on the old port does not block a new start', async () => {
    const other = createServer((_req, res) => res.writeHead(200).end('not crewroom'));
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', () => r()));
    const otherPort = (other.address() as AddressInfo).port;
    try {
      for (const pid of [process.pid, 999999]) {
        const dir = tempDir();
        const f = writeFixtures(dir);
        mkdirSync(f.home, { recursive: true });
        writeFileSync(join(f.home, 'bridge.json'), JSON.stringify({ port: otherPort, token: 'x', pid }));
        const b = await startBridge({ port: 0, ...f });
        open.push(b);
        expect(b.port).not.toBe(otherPort);
      }
    } finally {
      other.close();
    }
  });

  it('refuses to start with an invalid config', async () => {
    const dir = tempDir();
    const f = writeFixtures(dir);
    writeFileSync(f.configPath, '{}');
    const err = await startBridge({ port: 0, ...f }).catch((e) => e);
    expect((err as BridgeError).code).toBe('CONFIG_INVALID');
  });

  it('close removes bridge.json and drops clients', async () => {
    const { b, home } = await boot();
    const c = wsClient(b.port, b.token);
    await c.waitFor((m) => m.type === 'snapshot');
    await open.pop()!.close();
    expect(existsSync(join(home, 'bridge.json'))).toBe(false);
    expect(c.ws.readyState).not.toBe(WebSocket.OPEN);
  });
});
