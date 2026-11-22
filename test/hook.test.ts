import { beforeAll, describe, expect, it } from 'vitest';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { runHook, trimEvent } from '../src/hook/claude-hook.js';
import { tempDir } from './helpers.js';

const pre = (tool: string, tool_input: object, extra: object = {}) => ({
  hook_event_name: 'PreToolUse',
  session_id: 'sess-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: 'C:/Users/me/Desktop/crewroom',
  tool_name: tool,
  tool_input,
  ...extra,
});

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  const server = createServer(handler);
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, port: (server.address() as AddressInfo).port })));
}

function homeWith(port: number, token = 'tok') {
  const home = tempDir();
  writeFileSync(join(home, 'bridge.json'), JSON.stringify({ port, token, pid: process.pid }));
  return home;
}

describe('trimEvent', () => {
  it('keeps only the allowed fields', () => {
    const w = trimEvent(pre('Write', { file_path: 'C:/a.ts', content: 'secret code' }));
    expect(w).toEqual({ event: 'PreToolUse', session: 'sess-1', cwd: 'C:/Users/me/Desktop/crewroom', tool: 'Write', path: 'C:/a.ts' });
    const b = trimEvent(pre('Bash', { command: 'x'.repeat(500), description: 'd' }));
    expect(b?.command).toHaveLength(200);
  });

  it('maps Skill input', () => {
    expect(trimEvent(pre('Skill', { skill: 'b1kjuu-editor', args: 'client notes' }))).toMatchObject({ skill: 'b1kjuu-editor' });
    expect(JSON.stringify(trimEvent(pre('Skill', { skill: 'x', args: 'client notes' })))).not.toContain('client notes');
  });

  it('maps notebook_path and path to path', () => {
    expect(trimEvent(pre('NotebookEdit', { notebook_path: 'n.ipynb' }))?.path).toBe('n.ipynb');
    expect(trimEvent(pre('Grep', { pattern: 'p', path: 'src' }))?.path).toBe('src');
  });

  it('drops tool_response', () => {
    const e = trimEvent({ ...pre('Read', { file_path: 'a' }), hook_event_name: 'PostToolUse', tool_response: { content: 'secret' } });
    expect(JSON.stringify(e)).not.toContain('secret');
  });

  it('drops UserPromptSubmit prompt text', () => {
    const e = trimEvent({ hook_event_name: 'UserPromptSubmit', session_id: 's', cwd: 'c', prompt: 'my secret prompt' });
    expect(e).toEqual({ event: 'UserPromptSubmit', session: 's', cwd: 'c' });
  });

  it('returns null for unknown events and missing session', () => {
    expect(trimEvent({ hook_event_name: 'PreCompact', session_id: 's' })).toBeNull();
    expect(trimEvent({ hook_event_name: 'Stop' })).toBeNull();
    expect(trimEvent('nope')).toBeNull();
    expect(trimEvent(null)).toBeNull();
  });

  it('ignores non-string tool input fields', () => {
    expect(trimEvent(pre('Bash', { command: { evil: true } }))).not.toHaveProperty('command');
  });
});

describe('runHook', () => {
  it('resolves fast when bridge.json is missing', async () => {
    const t = Date.now();
    await runHook(JSON.stringify(pre('Read', {})), { home: tempDir() });
    expect(Date.now() - t).toBeLessThan(150);
  });

  it('resolves fast when the port refuses', async () => {
    const { server, port } = await listen(() => {});
    await new Promise((r) => server.close(r));
    const t = Date.now();
    await runHook(JSON.stringify(pre('Read', {})), { home: homeWith(port) });
    expect(Date.now() - t).toBeLessThan(1000); // proves it never hangs; the hook's own timer is 150 ms
  });

  it('resolves within the budget when the server never answers', async () => {
    const { server, port } = await listen(() => {});
    const t = Date.now();
    await runHook(JSON.stringify(pre('Read', {})), { home: homeWith(port), timeoutMs: 150 });
    expect(Date.now() - t).toBeLessThan(1000); // proves it never hangs; the hook's own timer is 150 ms
    server.closeAllConnections();
    server.close();
  });

  it('posts the trimmed event with the token', async () => {
    let got: { body: string; token: string | undefined; path: string | undefined } | undefined;
    const { server, port } = await listen((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        got = { body, token: req.headers['x-crewroom-token'] as string, path: req.url };
        res.writeHead(204).end();
      });
    });
    await runHook(JSON.stringify(pre('Skill', { skill: 'b1kjuu-editor' })), { home: homeWith(port, 'abc') });
    server.close();
    expect(got?.path).toBe('/events');
    expect(got?.token).toBe('abc');
    expect(JSON.parse(got!.body)).toMatchObject({ event: 'PreToolUse', skill: 'b1kjuu-editor', tool: 'Skill' });
  });

  it('does not post to a port left behind by a bridge that is no longer running', async () => {
    let posted = false;
    const { server, port } = await listen((req, res) => {
      posted = true;
      req.resume();
      res.writeHead(204).end();
    });
    const deadPid = spawnSync(process.execPath, ['-e', '']).pid!;
    const home = tempDir();
    writeFileSync(join(home, 'bridge.json'), JSON.stringify({ port, token: 'tok', pid: deadPid }));
    await runHook(JSON.stringify(pre('Read', {})), { home });
    server.close();
    expect(posted).toBe(false);
  });

  it('never rejects on garbage input', async () => {
    await expect(runHook('not json', { home: tempDir() })).resolves.toBeUndefined();
  });
});

describe('compiled hook', () => {
  const built = join(process.cwd(), 'dist', 'hook', 'claude-hook.js');
  beforeAll(() => {
    execSync('npx tsc -p tsconfig.build.json', { stdio: 'ignore' });
  }, 60000);

  it('has no non-builtin imports', () => {
    const src = readFileSync(built, 'utf8');
    const specs = [...src.matchAll(/(?:import|from)\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) expect(s).toMatch(/^node:/);
  });

  it('still posts when its folder is reached through a junction or symlink', async () => {
    let posted = false;
    const { server, port } = await listen((req, res) => {
      posted = true;
      req.resume();
      res.writeHead(204).end();
    });
    const real = homeWith(port);
    copyFileSync(built, join(real, 'hook.mjs'));
    const link = join(tempDir(), 'linked-home');
    symlinkSync(real, link, 'junction');
    // async spawn: spawnSync would block this process, so the test server could never answer
    const child = spawn(process.execPath, [join(link, 'hook.mjs')], { env: { ...process.env, CREWROOM_HOME: link } });
    child.stdin.end(JSON.stringify(pre('Read', { file_path: 'a' })));
    const code = await new Promise<number | null>((r) => child.on('close', r));
    server.close();
    expect(code).toBe(0);
    expect(posted).toBe(true);
  });

  it('exits 0 and prints nothing, also when copied out of the package as hook.mjs', () => {
    const home = tempDir();
    const installed = join(home, 'hook.mjs');
    mkdirSync(home, { recursive: true });
    copyFileSync(built, installed);
    for (const file of [built, installed]) {
      const r = spawnSync(process.execPath, [file], {
        input: JSON.stringify(pre('Read', { file_path: 'a' })),
        env: { ...process.env, CREWROOM_HOME: home },
        encoding: 'utf8',
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe('');
    }
  });
});
