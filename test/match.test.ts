import { describe, expect, it } from 'vitest';
import { defaultAnim, matchRule } from '../src/bridge/match.js';
import type { Rule } from '../src/shared/config-schema.js';
import { PRESETS } from '../src/init/presets.js';
import type { CrewEvent } from '../src/shared/events.js';

const ev = (e: Partial<CrewEvent>): CrewEvent => ({ event: 'PreToolUse', session: 's1', ...e });

describe('Kil example rules', () => {
  const kil = PRESETS.kil!.config.rules;
  it('a session working inside the EDITS folder (or below it) is the Editor', () => {
    expect(matchRule(kil, ev({ tool: 'Bash', cwd: 'C:\\Users\\B1kjuu\\EDITS' }))?.worker).toBe('editor');
    expect(matchRule(kil, ev({ tool: 'Bash', cwd: 'C:/Users/B1kjuu/EDITS/HUB' }))?.worker).toBe('editor');
    expect(matchRule(kil, ev({ tool: 'Bash', cwd: 'C:/Users/B1kjuu/Desktop/crewroom' }))).toBeNull();
  });

  it('a skill used inside EDITS still goes to its own worker', () => {
    expect(matchRule(kil, ev({ tool: 'Skill', skill: 'b1kjuu-writer', cwd: 'C:/Users/B1kjuu/EDITS/HUB' }))?.worker).toBe('writer');
    expect(matchRule(kil, ev({ tool: 'Skill', skill: 'impeccable', cwd: 'C:/Users/B1kjuu/EDITS/HUB' }))?.worker).toBe('designer');
  });
});
const one = (when: Rule['when'], action?: string): Rule[] => [{ worker: 'w', when, ...(action ? { action } : {}) }];

describe('matchRule', () => {
  it('skill exact and glob', () => {
    expect(matchRule(one({ skill: 'b1kjuu-editor' }), ev({ tool: 'Skill', skill: 'b1kjuu-editor' }))).toEqual({ worker: 'w' });
    const glob = one({ skill: 'superpowers:*' });
    expect(matchRule(glob, ev({ skill: 'superpowers:brainstorming' }))).not.toBeNull();
    expect(matchRule(glob, ev({ skill: 'b1kjuu-dev' }))).toBeNull();
  });

  it('tool glob', () => {
    const r = one({ tool: 'mcp__capcut__*' });
    expect(matchRule(r, ev({ tool: 'mcp__capcut__capcut_save' }))).not.toBeNull();
    expect(matchRule(r, ev({ tool: 'mcp__whatsapp__list_chats' }))).toBeNull();
  });

  it('command prefix', () => {
    const r = one({ command: 'ffmpeg*' });
    expect(matchRule(r, ev({ tool: 'Bash', command: '  ffmpeg -i a.mp4 b.mp4' }))).not.toBeNull();
    expect(matchRule(r, ev({ tool: 'Bash', command: 'npx ffmpeg-skill' }))).toBeNull();
  });

  it('windows path', () => {
    const r = one({ path: 'EDITS/**' });
    expect(matchRule(r, ev({ tool: 'Read', path: 'C:\\Users\\me\\EDITS\\client\\a.mp4' }))).not.toBeNull();
    expect(matchRule(r, ev({ tool: 'Read', path: 'c:/users/me/edits/a.mp4' }))).not.toBeNull();
    expect(matchRule(r, ev({ tool: 'Read', path: 'C:/Users/me/MYEDITS/a.mp4' }))).toBeNull();
  });

  it('single star stays in one folder', () => {
    const r = one({ path: 'EDITS/*.mp4' });
    expect(matchRule(r, ev({ path: 'C:/x/EDITS/a.mp4' }))).not.toBeNull();
    expect(matchRule(r, ev({ path: 'C:/x/EDITS/client/a.mp4' }))).toBeNull();
  });

  it('absolute path pattern is anchored', () => {
    const r = one({ cwd: 'C:/Users/me/Desktop/**' });
    expect(matchRule(r, ev({ cwd: 'C:\\Users\\me\\Desktop\\crewroom' }))).not.toBeNull();
    expect(matchRule(r, ev({ cwd: 'D:/C:/Users/me/Desktop/x' }))).toBeNull();
  });

  it('all keys must match', () => {
    const r = one({ tool: 'Bash', command: 'npm*' });
    expect(matchRule(r, ev({ tool: 'Bash', command: 'git status' }))).toBeNull();
    expect(matchRule(r, ev({ tool: 'Bash', command: 'npm test' }))).not.toBeNull();
  });

  it('list values', () => {
    const r = one({ skill: ['impeccable', 'b1kjuu-design'] });
    expect(matchRule(r, ev({ skill: 'impeccable' }))).not.toBeNull();
    expect(matchRule(r, ev({ skill: 'b1kjuu-design' }))).not.toBeNull();
    expect(matchRule(r, ev({ skill: 'kil-research' }))).toBeNull();
  });

  it('first match wins', () => {
    const rules: Rule[] = [
      { worker: 'a', when: { tool: 'Bash' }, action: 'first' },
      { worker: 'b', when: { tool: 'Bash' } },
    ];
    expect(matchRule(rules, ev({ tool: 'Bash' }))).toEqual({ worker: 'a', action: 'first' });
  });

  it('missing field fails', () => {
    expect(matchRule(one({ skill: '*' }), ev({ tool: 'Bash' }))).toBeNull();
  });

  it('regex characters in patterns are literal', () => {
    const r = one({ tool: 'a.b' });
    expect(matchRule(r, ev({ tool: 'axb' }))).toBeNull();
    expect(matchRule(r, ev({ tool: 'a.b' }))).not.toBeNull();
  });
});

describe('defaultAnim', () => {
  const cases: [Partial<CrewEvent>, string][] = [
    [{ tool: 'Read' }, 'read'],
    [{ tool: 'Grep' }, 'read'],
    [{ tool: 'Glob' }, 'read'],
    [{ tool: 'WebFetch' }, 'read'],
    [{ tool: 'Edit' }, 'type'],
    [{ tool: 'Write' }, 'type'],
    [{ tool: 'NotebookEdit' }, 'type'],
    [{ tool: 'Bash' }, 'run'],
    [{ tool: 'Agent' }, 'think'],
    [{ tool: 'Task' }, 'think'],
    [{ event: 'UserPromptSubmit' }, 'think'],
    [{ event: 'Notification' }, 'wait'],
    [{ tool: 'mcp__capcut__capcut_save' }, 'type'],
  ];
  it.each(cases)('%o -> %s', (e, anim) => {
    expect(defaultAnim(ev(e))).toBe(anim);
  });
});
