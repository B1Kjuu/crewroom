import { request } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import type { ServerMsg } from '../src/shared/events.js';

export const tempDir = (prefix = 'crewroom-') => mkdtempSync(join(tmpdir(), prefix));

export const testConfig = {
  office: { name: 'Test deck', setting: 'crew-deck' },
  workers: [{ id: 'editor', name: 'Editor', sprite: 'crew-2', color: '#3aa7ff', home: 'console-2' }],
  rules: [{ worker: 'editor', when: { skill: 'b1kjuu-editor' } }],
};

export function writeFixtures(dir: string) {
  const configPath = join(dir, 'office.config.json');
  writeFileSync(configPath, JSON.stringify(testConfig));
  const officeDir = join(dir, 'office');
  mkdirSync(officeDir);
  writeFileSync(join(officeDir, 'index.html'), '<!doctype html><html><head><title>t</title></head><body></body></html>');
  return { configPath, officeDir, home: join(dir, 'home') };
}

export function http(
  port: number,
  opts: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method: opts.method ?? 'GET', path: opts.path ?? '/', headers: { host: `127.0.0.1:${port}`, ...opts.headers } },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

export function postEvent(port: number, token: string, ev: object) {
  return http(port, {
    method: 'POST',
    path: '/events',
    headers: { 'x-crewroom-token': token, 'content-type': 'application/json' },
    body: JSON.stringify(ev),
  });
}

export interface Client {
  ws: WebSocket;
  msgs: ServerMsg[];
  closed: Promise<number>;
  waitFor(pred: (m: ServerMsg) => boolean, ms?: number): Promise<ServerMsg>;
}

export function wsClient(port: number, token: string, origin = `http://127.0.0.1:${port}`): Client {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/live?token=${token}`, { origin });
  const msgs: ServerMsg[] = [];
  const waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(String(d)) as ServerMsg;
    msgs.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  ws.on('error', () => {});
  const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
  return {
    ws,
    msgs,
    closed,
    waitFor(pred, ms = 3000) {
      const hit = msgs.find(pred);
      if (hit) return Promise.resolve(hit);
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timed out waiting for message')), ms);
        waiters.push({ pred, resolve: (m) => { clearTimeout(t); resolve(m); } });
      });
    },
  };
}
