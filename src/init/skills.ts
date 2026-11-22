// Reads skill names and descriptions (never the rest) and suggests a crew. No AI, nothing leaves the PC.
import { open, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OfficeConfig } from '../shared/config-schema.js';

export interface Skill {
  name: string;
  description: string;
}

const MAX_READ = 8192;

export function parseSkillFrontmatter(text: string): Skill | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const lines = m[1]!.split(/\r?\n/);
  const field = (key: string) => {
    const i = lines.findIndex((l) => l.startsWith(`${key}:`));
    if (i === -1) return undefined;
    const value = lines[i]!.slice(key.length + 1).trim();
    // YAML block ("description: >-" or "|"): the indented lines below are the value.
    if (/^[>|][+-]?$/.test(value)) {
      const block: string[] = [];
      for (const l of lines.slice(i + 1)) {
        if (!/^\s/.test(l) && l.trim()) break;
        if (l.trim()) block.push(l.trim());
      }
      return block.join(' ');
    }
    return value.replace(/^(["'])(.*)\1$/, '$2');
  };
  const name = field('name');
  if (!name) return null;
  return { name, description: field('description') ?? '' };
}

export async function scanSkills(dirs: string[]): Promise<Skill[]> {
  const out: Skill[] = [];
  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      try {
        const fh = await open(join(dir, entry, 'SKILL.md'), 'r');
        try {
          const buf = Buffer.alloc(MAX_READ);
          const { bytesRead } = await fh.read(buf, 0, MAX_READ, 0);
          const s = parseSkillFrontmatter(buf.subarray(0, bytesRead).toString('utf8'));
          if (s) out.push(s);
        } finally {
          await fh.close();
        }
      } catch {
        // not a skill folder
      }
    }
  }
  return out;
}

/**
 * Skills that come with installed plugins (~/.claude/plugins/installed_plugins.json lists them).
 * Claude Code calls these "plugin:skill", so that's the name rules must match.
 */
export async function scanPluginSkills(pluginsDir: string): Promise<Skill[]> {
  let installed: { plugins?: Record<string, { installPath?: unknown }[]> };
  try {
    installed = JSON.parse(await readFile(join(pluginsDir, 'installed_plugins.json'), 'utf8')) as typeof installed;
  } catch {
    return [];
  }
  const out: Skill[] = [];
  for (const [key, entries] of Object.entries(installed.plugins ?? {})) {
    const plugin = key.split('@')[0];
    const path = Array.isArray(entries) ? entries.find((e) => typeof e?.installPath === 'string')?.installPath : undefined;
    if (!plugin || typeof path !== 'string') continue;
    for (const s of await scanSkills([join(path, 'skills')])) out.push({ name: `${plugin}:${s.name}`, description: s.description });
  }
  return out;
}

export type RoleId = 'developer' | 'designer' | 'writer' | 'editor' | 'researcher' | 'operator';

interface Role {
  id: RoleId;
  name: string;
  color: string;
  keywords: string[];
}

// Keywords of 4+ letters also match longer words ("edit" -> "editing"); shorter ones must match exactly.
export const ROLES: Role[] = [
  { id: 'developer', name: 'Developer', color: '#e8452c', keywords: ['code', 'coding', 'dev', 'develop', 'programming', 'typescript', 'javascript', 'react', 'api', 'apis', 'debug', 'deploy', 'git', 'app', 'apps', 'backend'] },
  { id: 'designer', name: 'Designer', color: '#c86bd6', keywords: ['design', 'ui', 'ux', 'figma', 'css', 'layout', 'typography', 'color', 'colour', 'animat', 'motion', 'visual', 'frontend', 'graphic', 'logo', 'brand'] },
  { id: 'writer', name: 'Writer', color: '#5fd08a', keywords: ['write', 'writing', 'writer', 'copy', 'caption', 'email', 'blog', 'reply', 'replies', 'draft', 'pitch', 'newsletter'] },
  { id: 'editor', name: 'Editor', color: '#3aa7ff', keywords: ['video', 'edit', 'capcut', 'remotion', 'premiere', 'ffmpeg', 'footage', 'thumbnail', 'subtitle', 'reel', 'reels', 'render', 'revision'] },
  { id: 'researcher', name: 'Researcher', color: '#ffcf5c', keywords: ['research', 'search', 'lookup', 'find', 'leads', 'sources', 'compare', 'investigat'] },
  { id: 'operator', name: 'Operator', color: '#ff8a3d', keywords: ['whatsapp', 'slack', 'gmail', 'inbox', 'invoice', 'crm', 'schedul', 'calendar', 'message'] },
];

const tokens = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const hits = (words: string[], kw: string) => words.filter((w) => (kw.length >= 4 ? w.startsWith(kw) : w === kw)).length;

export function roleFor(skill: Skill): RoleId | null {
  const nameWords = tokens(skill.name);
  const descWords = tokens(skill.description);
  let best: RoleId | null = null;
  let bestScore = 0;
  let tie = false;
  for (const role of ROLES) {
    const score = role.keywords.reduce((n, kw) => n + 2 * hits(nameWords, kw) + hits(descWords, kw), 0);
    if (score > bestScore) {
      best = role.id;
      bestScore = score;
      tie = false;
    } else if (score > 0 && score === bestScore) {
      tie = true;
    }
  }
  return tie ? null : best;
}

const base = (): Omit<OfficeConfig, 'workers' | 'rules' | 'fallback'> => ({
  office: { name: 'My crew deck', setting: 'crew-deck' },
  actions: {},
  layout: null,
  sources: { inbox: { enabled: true, path: null }, log: [], webhook: { enabled: true } },
});

const worker = (role: Role, i: number): OfficeConfig['workers'][number] => ({
  id: role.id,
  name: role.name,
  sprite: `crew-${i + 1}` as OfficeConfig['workers'][number]['sprite'],
  color: role.color,
  home: `console-${i + 1}` as OfficeConfig['workers'][number]['home'],
});

export function suggestCrew(skills: Skill[]): OfficeConfig {
  const byRole = new Map<RoleId, string[]>();
  for (const s of skills) {
    const r = roleFor(s);
    if (r) byRole.set(r, [...(byRole.get(r) ?? []), s.name]);
  }
  const roles = ROLES.filter((r) => byRole.has(r.id));
  if (!roles.length) {
    return { ...base(), workers: [worker(ROLES[0]!, 0)], rules: [], fallback: 'developer' };
  }
  return {
    ...base(),
    workers: roles.map(worker),
    rules: roles.map((r) => ({ worker: r.id, when: { skill: byRole.get(r.id)! } })),
    fallback: byRole.has('developer') ? 'developer' : 'per-session',
  };
}
