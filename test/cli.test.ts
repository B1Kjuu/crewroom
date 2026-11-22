import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { main, startCommand, STARTER_CONFIG } from '../src/cli.js';
import { parseConfig } from '../src/shared/config-schema.js';
import { http, tempDir, testConfig, writeFixtures } from './helpers.js';

function capture() {
  const out: string[] = [];
  vi.spyOn(console, 'log').mockImplementation((...a) => void out.push(a.join(' ')));
  vi.spyOn(console, 'error').mockImplementation((...a) => void out.push(a.join(' ')));
  return out;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CREWROOM_HOME;
  delete process.env.CLAUDE_CONFIG_DIR;
});

describe('cli', () => {
  it('config check passes a good file', async () => {
    const out = capture();
    const f = join(tempDir(), 'c.json');
    writeFileSync(f, JSON.stringify(testConfig));
    expect(await main(['config', 'check', f])).toBe(0);
    expect(out.join('\n')).toContain('Config OK');
  });

  it('config check fails a bad file with the error', async () => {
    const out = capture();
    const f = join(tempDir(), 'c.json');
    writeFileSync(f, '{"office":{}}');
    expect(await main(['config', 'check', f])).toBe(1);
    expect(out.join('\n')).toMatch(/workers|office/);
  });

  it('config check fails a missing file', async () => {
    capture();
    expect(await main(['config', 'check', join(tempDir(), 'nope.json')])).toBe(1);
  });

  it('starter config is valid', () => {
    expect(parseConfig(JSON.stringify(STARTER_CONFIG)).ok).toBe(true);
  });

  it('start creates a starter config when missing and the bridge answers', async () => {
    const out = capture();
    const dir = tempDir();
    const { officeDir } = writeFixtures(dir);
    const configPath = join(dir, 'new', 'office.config.json');
    process.env.CREWROOM_HOME = join(dir, 'home');
    const b = await startCommand({ port: 0, configPath, open: false, officeDir });
    try {
      expect(existsSync(configPath)).toBe(true);
      expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(STARTER_CONFIG);
      expect((await http(b.port, { path: '/' })).status).toBe(200);
      expect(out.join('\n')).toContain(`crewroom running at http://127.0.0.1:${b.port}`);
    } finally {
      await b.close();
    }
  });

  it('a second start for the same home says where crewroom is already running and returns 1', async () => {
    const out = capture();
    const dir = tempDir();
    const f = writeFixtures(dir);
    process.env.CREWROOM_HOME = f.home;
    const first = await startCommand({ port: 0, configPath: f.configPath, open: false, officeDir: f.officeDir });
    try {
      expect(await main(['start', '--port', String(first.port), '--config', f.configPath, '--no-open'])).toBe(1);
      expect(out.join('\n')).toContain(`crewroom is already running at http://127.0.0.1:${first.port}`);
    } finally {
      await first.close();
    }
  });

  it('report writes one inbox line the bridge can read', async () => {
    capture();
    const dir = tempDir();
    process.env.CREWROOM_HOME = dir;
    expect(await main(['report', 'Writer', 'start', 'drafting', 'a', 'caption'])).toBe(0);
    const files = readdirSync(join(dir, 'inbox'));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.txt$/);
    expect(readFileSync(join(dir, 'inbox', files[0]!), 'utf8').trim()).toBe('Writer start: drafting a caption');
  });

  it('report without a status word sends a note', async () => {
    capture();
    const dir = tempDir();
    process.env.CREWROOM_HOME = dir;
    expect(await main(['report', 'Operator', 'replied', 'to', 'Hubert'])).toBe(0);
    const [file] = readdirSync(join(dir, 'inbox'));
    expect(readFileSync(join(dir, 'inbox', file!), 'utf8').trim()).toBe('Operator note: replied to Hubert');
  });

  it('report uses the inbox path from the config', async () => {
    capture();
    const dir = tempDir();
    process.env.CREWROOM_HOME = dir;
    const custom = join(dir, 'elsewhere');
    writeFileSync(join(dir, 'office.config.json'), JSON.stringify({ ...testConfig, sources: { inbox: { path: custom } } }));
    expect(await main(['report', 'Writer', 'done', 'x'])).toBe(0);
    expect(readdirSync(custom)).toHaveLength(1);
  });

  it('report with no text prints usage and returns 1', async () => {
    const out = capture();
    expect(await main(['report', 'Writer'])).toBe(1);
    expect(out.join('\n')).toContain('Usage');
  });

  it('unknown command prints usage and returns 1', async () => {
    const out = capture();
    expect(await main(['dance'])).toBe(1);
    expect(out.join('\n')).toContain('Usage');
  });

  it('hooks status lists missing events', async () => {
    const out = capture();
    const dir = tempDir();
    process.env.CLAUDE_CONFIG_DIR = join(dir, '.claude');
    process.env.CREWROOM_HOME = join(dir, '.crewroom');
    mkdirSync(process.env.CLAUDE_CONFIG_DIR);
    expect(await main(['hooks', 'status'])).toBe(0);
    expect(out.join('\n')).toContain('Not installed');
  });
});
