import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startBridge } from '../src/bridge/server.js';
import type { SnapshotMsg } from '../src/shared/events.js';
import { http, tempDir, testConfig, writeFixtures, wsClient } from './helpers.js';

type Bridge = Awaited<ReturnType<typeof startBridge>>;
const open: Bridge[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

const rows = [
  'HHHHHHHHHHHH',
  'HWWWWWWWWWWH',
  'HKKKKKKKKKKH',
  'H..........H',
  'H.C..C..SS.H',
  'H..........H',
  'H..........H',
  'HHHHHDHHHHHH',
];

async function boot(opts: { layoutFile?: unknown; configLayout?: string } = {}) {
  const dir = tempDir();
  const f = writeFixtures(dir);
  mkdirSync(f.home, { recursive: true });
  if (opts.layoutFile !== undefined) writeFileSync(join(f.home, 'layout.json'), JSON.stringify(opts.layoutFile));
  if (opts.configLayout) writeFileSync(f.configPath, JSON.stringify({ ...testConfig, layout: opts.configLayout }));
  const b = await startBridge({ port: 0, ...f });
  open.push(b);
  const c = wsClient(b.port, b.token);
  const snap = (await c.waitFor((m) => m.type === 'snapshot')) as SnapshotMsg;
  return { ...f, dir, b, c, snap };
}

const post = (port: number, token: string | undefined, body: unknown) =>
  http(port, {
    method: 'POST',
    path: '/layout',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-crewroom-token': token } : {}) },
    body: JSON.stringify(body),
  });

describe('layouts in the bridge', () => {
  it('sends no layout when none is saved', async () => {
    expect((await boot()).snap.layout).toBeNull();
  });

  it('loads ~/.crewroom/layout.json when it exists', async () => {
    const { snap } = await boot({ layoutFile: { setting: 'crew-deck', rows } });
    expect(snap.layout).toEqual(rows);
    expect(snap.configError).toBeNull();
  });

  it('a broken layout shows an error and falls back to the built-in deck', async () => {
    const { snap } = await boot({ layoutFile: { setting: 'crew-deck', rows: ['HHH'] } });
    expect(snap.layout).toBeNull();
    expect(snap.configError).toMatch(/layout/i);
  });

  it('POST /layout saves, then everyone gets the new layout', async () => {
    const { b, c, home } = await boot();
    expect((await post(b.port, b.token, { rows })).status).toBe(204);
    expect(JSON.parse(readFileSync(join(home, 'layout.json'), 'utf8'))).toEqual({ setting: 'crew-deck', rows });
    await c.waitFor((m) => m.type === 'snapshot' && JSON.stringify(m.layout) === JSON.stringify(rows));
  });

  it('POST /layout explains what is wrong', async () => {
    const { b } = await boot();
    const r = await post(b.port, b.token, { rows: rows.map((x) => x.replace('D', 'H')) });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).errors.join()).toMatch(/door/i);
  });

  it('POST /layout with rows null goes back to the built-in deck', async () => {
    const { b, c, home } = await boot({ layoutFile: { setting: 'crew-deck', rows } });
    expect((await post(b.port, b.token, { rows: null })).status).toBe(204);
    expect(existsSync(join(home, 'layout.json'))).toBe(false);
    await c.waitFor((m) => m.type === 'snapshot' && m.layout === null && c.msgs.filter((x) => x.type === 'snapshot').length > 1);
  });

  it('needs the token', async () => {
    const { b } = await boot();
    expect((await post(b.port, undefined, { rows })).status).toBe(401);
  });

  it('serves custom crew sheets from ~/.crewroom/sprites, and nothing else', async () => {
    const { b, home } = await boot();
    mkdirSync(join(home, 'sprites'), { recursive: true });
    writeFileSync(join(home, 'sprites', 'my-bot.png'), 'PNGDATA');
    writeFileSync(join(home, 'secret.png'), 'NOPE');
    const ok = await http(b.port, { path: '/sprites/my-bot.png' });
    expect([ok.status, ok.body]).toEqual([200, 'PNGDATA']);
    expect((await http(b.port, { path: '/sprites/missing.png' })).status).toBe(404);
    expect((await http(b.port, { path: '/sprites/..%2fsecret.png' })).status).toBe(404);
    expect((await http(b.port, { path: '/sprites/My-Bot.png' })).status).toBe(404);
    expect((await http(b.port, { path: '/sprites/my-bot.txt' })).status).toBe(404);
  });

  it('will not overwrite a file that is not a layout', async () => {
    const dir = tempDir();
    const notALayout = join(dir, 'important.json');
    writeFileSync(notALayout, '{"office": "my real config"}');
    const { b } = await boot({ configLayout: notALayout });
    const r = await post(b.port, b.token, { rows });
    expect(r.status).toBe(400);
    expect(JSON.parse(r.body).errors.join()).toMatch(/isn't a crewroom layout/);
    expect(readFileSync(notALayout, 'utf8')).toBe('{"office": "my real config"}');
  });

  it('may overwrite a layout file that has problems (that is how you fix it)', async () => {
    const dir = tempDir();
    const broken = join(dir, 'deck.json');
    writeFileSync(broken, JSON.stringify({ setting: 'crew-deck', rows: ['HHH'] }));
    const { b } = await boot({ configLayout: broken });
    expect((await post(b.port, b.token, { rows })).status).toBe(204);
  });

  it('a relative "layout" path is next to the config, not wherever crewroom was started', async () => {
    const dir = tempDir();
    const f = writeFixtures(dir);
    writeFileSync(f.configPath, JSON.stringify({ ...testConfig, layout: 'decks/mine.json' }));
    const b = await startBridge({ port: 0, ...f });
    open.push(b);
    expect((await post(b.port, b.token, { rows })).status).toBe(204);
    expect(existsSync(join(dir, 'decks', 'mine.json'))).toBe(true);
  });

  it('saves to the path the config names', async () => {
    const custom = join(tempDir(), 'decks', 'mine.json');
    const { b } = await boot({ configLayout: custom });
    expect((await post(b.port, b.token, { rows })).status).toBe(204);
    expect(JSON.parse(readFileSync(custom, 'utf8')).rows).toEqual(rows);
  });
});
