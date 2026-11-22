import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSkillFrontmatter, roleFor, scanPluginSkills, scanSkills, suggestCrew } from '../src/init/skills.js';
import { parseConfig } from '../src/shared/config-schema.js';
import { tempDir } from './helpers.js';

const skill = (dir: string, folder: string, body: string) => {
  mkdirSync(join(dir, folder), { recursive: true });
  writeFileSync(join(dir, folder, 'SKILL.md'), body);
};

describe('parseSkillFrontmatter', () => {
  it('reads name and description', () => {
    expect(parseSkillFrontmatter('---\nname: my-editor\ndescription: Edit client videos in CapCut\n---\n# body')).toEqual({
      name: 'my-editor',
      description: 'Edit client videos in CapCut',
    });
  });
  it('handles quotes and CRLF', () => {
    expect(parseSkillFrontmatter('---\r\nname: "writer"\r\ndescription: \'Write captions\'\r\n---\r\n')).toEqual({ name: 'writer', description: 'Write captions' });
  });
  it('reads multi-line descriptions (YAML > and | blocks)', () => {
    expect(parseSkillFrontmatter('---\nname: cuts\ndescription: >-\n  Edit client videos\n  and thumbnails\nlicense: MIT\n---')).toEqual({
      name: 'cuts',
      description: 'Edit client videos and thumbnails',
    });
    expect(parseSkillFrontmatter('---\nname: w\ndescription: |\n  Write captions\n  for reels\n---')?.description).toBe('Write captions for reels');
  });

  it('returns null without frontmatter or a name', () => {
    expect(parseSkillFrontmatter('# just markdown')).toBeNull();
    expect(parseSkillFrontmatter('---\ndescription: x\n---')).toBeNull();
  });
});

describe('roleFor', () => {
  it('maps skills to roles by keywords', () => {
    expect(roleFor({ name: 'b1kjuu-editor', description: 'Client video edits, revisions, thumbnails, CapCut drafts' })).toBe('editor');
    expect(roleFor({ name: 'impeccable', description: 'Design and polish frontend UI: layout, typography, color' })).toBe('designer');
    expect(roleFor({ name: 'b1kjuu-writer', description: 'Write captions, client replies, emails' })).toBe('writer');
    expect(roleFor({ name: 'kil-research', description: 'Web research, lookups, finding leads' })).toBe('researcher');
    expect(roleFor({ name: 'b1kjuu-dev', description: 'Coding stack and conventions for web apps' })).toBe('developer');
  });
  it('returns null when nothing matches', () => {
    expect(roleFor({ name: 'statusbar', description: 'Show the bar' })).toBeNull();
  });
});

describe('scanSkills', () => {
  it('reads every SKILL.md one level down and skips the rest', async () => {
    const dir = tempDir();
    skill(dir, 'a', '---\nname: a\ndescription: Write emails\n---');
    skill(dir, 'b', 'no frontmatter');
    writeFileSync(join(dir, 'loose.md'), '---\nname: loose\n---');
    expect(await scanSkills([dir, join(dir, 'missing')])).toEqual([{ name: 'a', description: 'Write emails' }]);
  });
});

describe('scanPluginSkills', () => {
  it('reads skills from installed plugins, named plugin:skill', async () => {
    const dir = tempDir();
    const install = join(dir, 'cache', 'market', 'video-tools', '1.0.0');
    skill(join(install, 'skills'), 'cutter', '---\nname: cutter\ndescription: Edit videos\n---');
    writeFileSync(
      join(dir, 'installed_plugins.json'),
      JSON.stringify({ version: 2, plugins: { 'video-tools@market': [{ scope: 'user', installPath: install, version: '1.0.0' }] } }),
    );
    expect(await scanPluginSkills(dir)).toEqual([{ name: 'video-tools:cutter', description: 'Edit videos' }]);
  });

  it('returns nothing when there is no plugins file or it is broken', async () => {
    expect(await scanPluginSkills(join(tempDir(), 'none'))).toEqual([]);
    const dir = tempDir();
    writeFileSync(join(dir, 'installed_plugins.json'), '{oops');
    expect(await scanPluginSkills(dir)).toEqual([]);
  });

  it('plugin skills are routed by their plugin:skill name', () => {
    const config = suggestCrew([{ name: 'video-tools:cutter', description: 'Edit videos' }]);
    expect(config.rules).toContainEqual({ worker: 'editor', when: { skill: ['video-tools:cutter'] } });
  });
});

describe('suggestCrew', () => {
  const skills = [
    { name: 'my-editor', description: 'Edit videos and thumbnails' },
    { name: 'captions', description: 'Write captions and replies' },
    { name: 'webdev', description: 'Coding React apps and APIs' },
    { name: 'other', description: 'Show a status bar' },
  ];

  it('makes a valid config with one worker per role that has skills', () => {
    const config = suggestCrew(skills);
    expect(parseConfig(JSON.stringify(config)).ok).toBe(true);
    expect(config.workers.map((w) => w.id)).toEqual(['developer', 'writer', 'editor']);
    expect(config.rules).toContainEqual({ worker: 'editor', when: { skill: ['my-editor'] } });
    expect(config.fallback).toBe('developer');
  });

  it('gives each worker its own console, sprite and colour', () => {
    const w = suggestCrew(skills).workers;
    expect(new Set(w.map((x) => x.home)).size).toBe(w.length);
    expect(new Set(w.map((x) => x.sprite)).size).toBe(w.length);
  });

  it('falls back to per-session when no developer skill exists', () => {
    expect(suggestCrew([{ name: 'cap', description: 'Write captions' }]).fallback).toBe('per-session');
  });

  it('with no matching skills, still gives a working starter crew', () => {
    const c = suggestCrew([]);
    expect(parseConfig(JSON.stringify(c)).ok).toBe(true);
    expect(c.workers.length).toBeGreaterThan(0);
  });
});
