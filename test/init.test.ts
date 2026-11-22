import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initCommand } from '../src/init/init.js';
import { PRESETS } from '../src/init/presets.js';
import { parseConfig } from '../src/shared/config-schema.js';
import { tempDir } from './helpers.js';

function setup() {
  const dir = tempDir();
  const skillsDir = join(dir, 'skills');
  mkdirSync(join(skillsDir, 'cuts'), { recursive: true });
  writeFileSync(join(skillsDir, 'cuts', 'SKILL.md'), '---\nname: cuts\ndescription: Edit videos in CapCut\n---');
  const configPath = join(dir, 'home', 'office.config.json');
  const out: string[] = [];
  const asked: string[] = [];
  const run = (answers: string[], extra: Partial<Parameters<typeof initCommand>[0]> = {}) =>
    initCommand({
      configPath,
      skillsDirs: [skillsDir],
      yes: false,
      ask: async (q) => {
        asked.push(q);
        return answers.shift() ?? '';
      },
      installHooks: async () => 'installed',
      print: (s) => void out.push(s),
      ...extra,
    });
  return { dir, configPath, out, asked, run };
}

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

describe('presets', () => {
  it('every preset is a valid config', () => {
    for (const [name, p] of Object.entries(PRESETS)) expect(parseConfig(JSON.stringify(p.config)).ok, name).toBe(true);
  });

  it('the kil preset is the same as examples/kil.office.config.json', () => {
    expect(PRESETS.kil!.config).toEqual(read(new URL('../examples/kil.office.config.json', import.meta.url).pathname.replace(/^\/([a-z]:)/i, '$1')));
  });
});

describe('crewroom init', () => {
  it('suggests a crew from skills, writes it on yes, then offers the hook', async () => {
    const s = setup();
    let hooked = false;
    expect(await s.run(['1', 'y', 'y'], { installHooks: async () => ((hooked = true), 'installed') })).toBe(0);
    const c = read(s.configPath);
    expect(c.workers.map((w: { id: string }) => w.id)).toEqual(['editor']);
    expect(s.out.join('\n')).toContain('Editor');
    expect(s.out.join('\n')).toContain('cuts');
    expect(hooked).toBe(true);
  });

  it('writes nothing when you answer no', async () => {
    const s = setup();
    expect(await s.run(['2', 'n'])).toBe(0);
    expect(existsSync(s.configPath)).toBe(false);
  });

  it('picks a preset by number or name', async () => {
    const s = setup();
    await s.run(['creator', 'y', 'n']);
    expect(read(s.configPath).workers.map((w: { id: string }) => w.id)).toContain('editor');
    const t = setup();
    await t.run(['2', 'y', 'n']);
    expect(read(t.configPath)).toEqual(PRESETS['solo-dev']!.config);
  });

  it('--preset and --yes ask nothing and leave Claude settings alone', async () => {
    const s = setup();
    let hooked = false;
    expect(await s.run([], { preset: 'agency', yes: true, installHooks: async () => ((hooked = true), 'installed') })).toBe(0);
    expect(s.asked).toEqual([]);
    expect(read(s.configPath)).toEqual(PRESETS.agency!.config);
    expect(hooked).toBe(false);
    expect(s.out.join('\n')).toContain('crewroom hooks install');
  });

  it('--yes --hook also adds the hook', async () => {
    const s = setup();
    let hooked = false;
    await s.run([], { preset: 'agency', yes: true, hook: true, installHooks: async () => ((hooked = true), 'installed') });
    expect(hooked).toBe(true);
  });

  it('backs up an existing config before replacing it', async () => {
    const s = setup();
    mkdirSync(join(s.dir, 'home'), { recursive: true });
    writeFileSync(s.configPath, '{"old": true}');
    await s.run([], { preset: 'solo-dev', yes: true });
    const backups = readdirSync(join(s.dir, 'home')).filter((f) => f.startsWith('office.config.json.bak-'));
    expect(backups).toHaveLength(1);
    expect(readFileSync(join(s.dir, 'home', backups[0]!), 'utf8')).toBe('{"old": true}');
  });

  it('an unknown preset is an error', async () => {
    const s = setup();
    expect(await s.run([], { preset: 'nope', yes: true })).toBe(1);
    expect(s.out.join('\n')).toContain('nope');
  });
});
