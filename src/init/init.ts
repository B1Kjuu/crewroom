// `crewroom init`: pick a starting crew, see it, write it, optionally add the hook.
import { copyFileSync, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OfficeConfig } from '../shared/config-schema.js';
import { PRESETS } from './presets.js';
import { scanPluginSkills, scanSkills, suggestCrew } from './skills.js';

export interface InitOptions {
  configPath: string;
  skillsDirs: string[];
  /** ~/.claude/plugins: skills that come with installed plugins. */
  pluginsDir?: string;
  preset?: string;
  yes: boolean;
  /** Also add the Claude Code hook without asking. --yes alone never touches ~/.claude/settings.json. */
  hook?: boolean;
  ask: (question: string) => Promise<string>;
  installHooks: () => Promise<'installed' | 'unchanged' | 'cancelled'>;
  print: (line: string) => void;
}

const MENU = ['skills', 'solo-dev', 'creator', 'agency', 'kil'] as const;

function describe(config: OfficeConfig): string[] {
  const lines = [`  ${config.office.name}`];
  for (const w of config.workers) {
    const what = config.rules
      .filter((r) => r.worker === w.id)
      .flatMap((r) => Object.values(r.when).flatMap((v) => (typeof v === 'string' ? [v] : (v ?? []))));
    const shown = what.slice(0, 4).join(', ') + (what.length > 4 ? ` (+${what.length - 4} more)` : '');
    const tag = config.fallback === w.id ? '  (also gets anything no rule claims)' : '';
    lines.push(`  ${w.name.padEnd(11)} ${w.home.padEnd(10)} ${shown || '-'}${tag}`);
  }
  if (config.fallback === 'per-session') lines.push('  Anything no rule claims gets its own "Crew N".');
  return lines;
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function initCommand(o: InitOptions): Promise<number> {
  let config: OfficeConfig;
  if (o.preset) {
    const p = PRESETS[o.preset];
    if (!p) {
      o.print(`Unknown preset "${o.preset}". Choose one of: ${Object.keys(PRESETS).join(', ')}.`);
      return 1;
    }
    config = p.config;
  } else {
    const own = await scanSkills(o.skillsDirs);
    const fromPlugins = o.pluginsDir ? await scanPluginSkills(o.pluginsDir) : [];
    const skills = [...own, ...fromPlugins];
    o.print(`Found ${own.length} skill${own.length === 1 ? '' : 's'} of your own and ${fromPlugins.length} from plugins.`);
    o.print('Start from:');
    o.print(`  1) Your skills (crewroom suggests a crew from their names and descriptions)`);
    MENU.slice(1).forEach((key, i) => o.print(`  ${i + 2}) ${PRESETS[key]!.label}`));
    const answer = (await o.ask('Choose 1-5 or a preset name [1]: ')).trim().toLowerCase() || '1';
    const key = /^\d$/.test(answer) ? MENU[Number(answer) - 1] : (MENU as readonly string[]).includes(answer) ? answer : undefined;
    if (!key) {
      o.print(`"${answer}" isn't one of the choices.`);
      return 1;
    }
    config = key === 'skills' ? suggestCrew(skills) : PRESETS[key]!.config;
  }

  o.print('');
  for (const line of describe(config)) o.print(line);
  o.print('');

  if (!o.yes && !/^y(es)?$/i.test((await o.ask(`Write this to ${o.configPath}? [y/N] `)).trim())) {
    o.print('Nothing written.');
    return 0;
  }
  mkdirSync(dirname(o.configPath), { recursive: true });
  if (existsSync(o.configPath)) {
    const backup = `${o.configPath}.bak-${stamp()}`;
    copyFileSync(o.configPath, backup);
    o.print(`Saved your old config as ${backup}`);
  }
  const tmp = `${o.configPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n');
  renameSync(tmp, o.configPath);
  o.print(`Wrote ${o.configPath}`);

  const wantHook = o.yes ? !!o.hook : o.hook || /^y(es)?$/i.test((await o.ask('Add the Claude Code hook now? [y/N] ')).trim());
  if (wantHook) {
    const r = await o.installHooks();
    o.print({ installed: 'Hook installed.', unchanged: 'Hook was already installed.', cancelled: 'Hook not installed.' }[r]);
  } else {
    o.print('Claude Code settings left alone. Add the hook later with: crewroom hooks install');
  }
  o.print('Next: crewroom start');
  return 0;
}
