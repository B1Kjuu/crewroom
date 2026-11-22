import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startBridge } from '../src/bridge/server.js';
import { http, tempDir, writeFixtures, wsClient } from './helpers.js';

type Bridge = Awaited<ReturnType<typeof startBridge>>;
const open: Bridge[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.close();
});

const workers = [
  { id: 'writer', name: 'Writer', sprite: 'crew-4', color: '#5fd08a', home: 'console-4' },
  { id: 'advisor', name: 'Advisor', sprite: 'crew-7', color: '#9aa4ff', home: 'console-7' },
];

async function boot(sources: object, extra: object = {}) {
  const dir = tempDir();
  const f = writeFixtures(dir);
  const config = { office: { name: 'Deck', setting: 'crew-deck' }, workers, sources, ...extra };
  writeFileSync(f.configPath, JSON.stringify(config));
  const b = await startBridge({ port: 0, ...f });
  open.push(b);
  const c = wsClient(b.port, b.token);
  await c.waitFor((m) => m.type === 'snapshot');
  return { ...f, dir, b, c, config };
}

const report = (port: number, token: string | undefined, body: object) =>
  http(port, {
    method: 'POST',
    path: '/report',
    headers: { 'content-type': 'application/json', ...(token ? { 'x-crewroom-token': token } : {}) },
    body: JSON.stringify(body),
  });

const working = (id: string) => (m: { type: string; worker?: { id: string; state: string } }) =>
  m.type === 'worker' && m.worker?.id === id && m.worker.state === 'working';

describe('webhook', () => {
  it('POST /report puts the named worker to work', async () => {
    const { b, c } = await boot({});
    expect((await report(b.port, b.token, { worker: 'Writer', status: 'start', text: 'caption' })).status).toBe(204);
    await c.waitFor(working('writer'));
  });

  it('status defaults to note; bad bodies and missing tokens are refused', async () => {
    const { b, c } = await boot({});
    expect((await report(b.port, b.token, { worker: 'writer' })).status).toBe(204);
    await c.waitFor(working('writer'));
    expect((await report(b.port, undefined, { worker: 'writer' })).status).toBe(401);
    expect((await report(b.port, b.token, { worker: 'writer', status: 'dancing' })).status).toBe(400);
    expect((await report(b.port, b.token, { worker: 'writer', prompt: 'secret' })).status).toBe(400);
  });

  it('is off when sources.webhook.enabled is false', async () => {
    const { b } = await boot({ webhook: { enabled: false } });
    expect((await report(b.port, b.token, { worker: 'writer' })).status).toBe(404);
  });
});

describe('inbox in the bridge', () => {
  it('a file dropped in the configured inbox moves the worker', async () => {
    const dir = tempDir();
    const inbox = join(dir, 'my-inbox');
    const { c } = await boot({ inbox: { enabled: true, path: inbox } });
    writeFileSync(join(inbox, '1.txt'), 'Writer start: caption');
    await c.waitFor(working('writer'));
  });

  it('a file it cannot read shows in the activity log as ignored', async () => {
    const dir = tempDir();
    const inbox = join(dir, 'inbox');
    const { c } = await boot({ inbox: { enabled: true, path: inbox } });
    writeFileSync(join(inbox, 'oops.txt'), 'no colon here');
    const m = await c.waitFor((x) => x.type === 'log' && (x.entry.label ?? '').includes('ignored'), 5000);
    expect(m).toMatchObject({ entry: { worker: 'inbox', label: 'ignored oops.txt: no "Worker: text" line' } });
  });

  it('stops reading the inbox when the bridge closes', async () => {
    const dir = tempDir();
    const inbox = join(dir, 'inbox');
    await boot({ inbox: { enabled: true, path: inbox } });
    await open.pop()!.close();
    writeFileSync(join(inbox, '1.txt'), 'Writer: after close');
    await new Promise((r) => setTimeout(r, 2500));
    expect(readdirSync(inbox)).toEqual(['1.txt']);
  });

  it('follows a new inbox path after a config edit', async () => {
    const dir = tempDir();
    const first = join(dir, 'a');
    const second = join(dir, 'b');
    const { c, configPath, config } = await boot({ inbox: { enabled: true, path: first } });
    writeFileSync(configPath, JSON.stringify({ ...config, sources: { inbox: { enabled: true, path: second } } }));
    await c.waitFor((m) => m.type === 'snapshot' && m.configError === null && c.msgs.filter((x) => x.type === 'snapshot').length > 1);
    mkdirSync(second, { recursive: true });
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(join(second, '1.txt'), 'Writer: moved');
    await c.waitFor(working('writer'));
  });
});

describe('log watcher in the bridge', () => {
  it('a new line a rule claims moves that worker', async () => {
    const dir = tempDir();
    const log = join(dir, 'log.md');
    writeFileSync(log, 'old line\n');
    const { c } = await boot(
      { log: [{ path: log }] },
      { rules: [{ worker: 'advisor', when: { source: 'log', text: '*brief*' } }] },
    );
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(log, '2026-11-22 | morning brief | daily/2026-11-22.md\nold line\n');
    await c.waitFor(working('advisor'), 8000);
  });
});
