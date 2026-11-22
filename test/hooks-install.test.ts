import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hookCommand, hooksStatus, installHooks, isOurs, planInstall, uninstallHooks } from '../src/bridge/hooks-install.js';
import { HOOK_EVENTS } from '../src/shared/events.js';
import { tempDir } from './helpers.js';

// A typical settings.json that already has hooks from other tools.
const realish = () => ({
  model: 'opus',
  hooks: {
    PreToolUse: [
      {
        matcher: 'Grep|Glob|Bash',
        hooks: [{ type: 'command', command: 'C:/tools/some-indexer.exe', args: ['hook-augment'], timeout: 5 }],
      },
      { matcher: '', hooks: [{ type: 'command', command: 'node "C:\\Users\\me\\.other-tool\\hook.js"', timeout: 5 }] },
    ],
    PostToolUse: [
      { matcher: 'Read', hooks: [{ type: 'command', command: 'C:/tools/some-indexer.exe', args: ['hook-augment'], timeout: 5 }] },
    ],
  },
  permissions: { deny: ['mcp__whatsapp__send_message'] },
});

function setup(settings: unknown | null = realish()) {
  const dir = tempDir();
  const claudeDir = join(dir, '.claude');
  const home = join(dir, '.crewroom');
  mkdirSync(claudeDir);
  if (settings !== null) writeFileSync(join(claudeDir, 'settings.json'), typeof settings === 'string' ? settings : JSON.stringify(settings, null, 2));
  const hookSource = join(dir, 'claude-hook.js');
  writeFileSync(hookSource, '// hook');
  const read = () => JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'));
  return { dir, claudeDir, home, hookSource, read };
}

const yes = { yes: true, confirm: async () => true };

describe('hook command', () => {
  it('uses forward slashes and hook.mjs', () => {
    expect(hookCommand('C:\\Users\\me\\.crewroom')).toBe('node "C:/Users/me/.crewroom/hook.mjs"');
  });

  it('isOurs recognises only crewroom', () => {
    expect(isOurs('node "C:/Users/me/.crewroom/hook.mjs"')).toBe(true);
    expect(isOurs('node "C:\\Users\\me\\.other-tool\\hook.js"')).toBe(false);
    expect(isOurs('node "D:/custom/hook.mjs"', 'D:\\custom')).toBe(true);
  });
});

describe('planInstall', () => {
  it('adds one entry per event and keeps the others untouched', () => {
    const before = realish();
    const { next, added } = planInstall(before, 'node "C:/h/.crewroom/hook.mjs"');
    expect(added).toEqual([...HOOK_EVENTS]);
    const hooks = next.hooks as Record<string, unknown[]>;
    expect(hooks.PreToolUse!.slice(0, 2)).toEqual(realish().hooks.PreToolUse);
    expect(hooks.PostToolUse![0]).toEqual(realish().hooks.PostToolUse[0]);
    expect(hooks.Stop).toEqual([{ matcher: '', hooks: [{ type: 'command', command: 'node "C:/h/.crewroom/hook.mjs"', timeout: 2 }] }]);
    expect(next.model).toBe('opus');
    expect(before).toEqual(realish());
  });
});

describe('installHooks', () => {
  it('installs, writes a backup and copies hook.mjs', async () => {
    const s = setup();
    expect(await installHooks({ ...s, ...yes })).toBe('installed');
    expect(readFileSync(join(s.home, 'hook.mjs'), 'utf8')).toBe('// hook');
    const backups = readdirSync(s.claudeDir).filter((f) => f.startsWith('settings.json.crewroom-backup-'));
    expect(backups).toHaveLength(1);
    expect(JSON.parse(readFileSync(join(s.claudeDir, backups[0]!), 'utf8'))).toEqual(realish());
    expect(hooksStatus(s.claudeDir, s.home).missing).toEqual([]);
    expect(readFileSync(join(s.claudeDir, 'settings.json'), 'utf8').endsWith('}\n')).toBe(true);
  });

  it('install twice adds nothing', async () => {
    const s = setup();
    await installHooks({ ...s, ...yes });
    const once = s.read();
    expect(await installHooks({ ...s, ...yes })).toBe('unchanged');
    expect(s.read()).toEqual(once);
  });

  it('cancelled confirm writes nothing', async () => {
    const s = setup();
    let summary = '';
    const r = await installHooks({ ...s, yes: false, confirm: async (t) => ((summary = t), false) });
    expect(r).toBe('cancelled');
    expect(summary).toContain('PreToolUse');
    expect(s.read()).toEqual(realish());
    expect(existsSync(join(s.home, 'hook.mjs'))).toBe(false);
  });

  it('creates settings.json when it is missing', async () => {
    const s = setup(null);
    expect(await installHooks({ ...s, ...yes })).toBe('installed');
    expect(Object.keys(s.read().hooks)).toEqual([...HOOK_EVENTS]);
  });

  it('refuses a malformed settings.json and leaves it alone', async () => {
    const s = setup('{ "hooks": { oops ');
    await expect(installHooks({ ...s, ...yes })).rejects.toThrow(/not valid JSON/);
    expect(readFileSync(join(s.claudeDir, 'settings.json'), 'utf8')).toBe('{ "hooks": { oops ');
    expect(readdirSync(s.claudeDir)).toEqual(['settings.json']);
  });

  it('writes settings.json through a temp file, so a failed write never leaves it half-written', async () => {
    const s = setup();
    // Block the temp file: an atomic write must fail here and leave the original as it was.
    mkdirSync(join(s.claudeDir, 'settings.json.crewroom-tmp'));
    await expect(installHooks({ ...s, ...yes })).rejects.toThrow();
    expect(s.read()).toEqual(realish());
  });

  it('leaves no temp file behind after a normal install', async () => {
    const s = setup();
    await installHooks({ ...s, ...yes });
    expect(existsSync(join(s.claudeDir, 'settings.json.crewroom-tmp'))).toBe(false);
  });

  it('refuses when hooks is not an object', async () => {
    const s = setup({ hooks: [] });
    await expect(installHooks({ ...s, ...yes })).rejects.toThrow();
  });
});

describe('uninstallHooks', () => {
  it('removes only crewroom and restores the original', async () => {
    const s = setup();
    await installHooks({ ...s, ...yes });
    expect(await uninstallHooks({ claudeDir: s.claudeDir, home: s.home, ...yes })).toBe('removed');
    expect(s.read()).toEqual(realish());
    expect(await uninstallHooks({ claudeDir: s.claudeDir, home: s.home, ...yes })).toBe('unchanged');
  });

  it('drops events that only had crewroom', async () => {
    const s = setup({});
    await installHooks({ ...s, ...yes });
    await uninstallHooks({ claudeDir: s.claudeDir, home: s.home, ...yes });
    expect(s.read()).toEqual({});
  });
});

describe('hooksStatus', () => {
  it('lists installed and missing events', async () => {
    const s = setup();
    expect(hooksStatus(s.claudeDir, s.home)).toEqual({ installed: [], missing: [...HOOK_EVENTS] });
    await installHooks({ ...s, ...yes });
    expect(hooksStatus(s.claudeDir, s.home)).toEqual({ installed: [...HOOK_EVENTS], missing: [] });
  });
});
