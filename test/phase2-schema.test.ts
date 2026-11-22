import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../src/shared/config-schema.js';
import { reportEventSchema } from '../src/shared/events.js';
import { expandHome } from '../src/shared/paths.js';
import { matchRule } from '../src/bridge/match.js';
import type { Rule } from '../src/shared/config-schema.js';

const base = {
  office: { name: 'Deck', setting: 'crew-deck' },
  workers: [{ id: 'advisor', name: 'Advisor', sprite: 'crew-1', color: '#e8452c', home: 'console-1' }],
};

describe('report events', () => {
  it('accepts a report', () => {
    expect(reportEventSchema.safeParse({ event: 'Report', session: 'inbox:writer', source: 'inbox', worker: 'Writer', status: 'start', text: 'caption' }).success).toBe(true);
  });
  it('rejects an unknown status or source', () => {
    expect(reportEventSchema.safeParse({ event: 'Report', session: 's', source: 'inbox', status: 'dancing' }).success).toBe(false);
    expect(reportEventSchema.safeParse({ event: 'Report', session: 's', source: 'fax', status: 'note' }).success).toBe(false);
  });
  it('caps text at 200 chars', () => {
    expect(reportEventSchema.safeParse({ event: 'Report', session: 's', source: 'webhook', status: 'note', text: 'x'.repeat(201) }).success).toBe(false);
  });
});

describe('sources config', () => {
  it('defaults: inbox on at the default path, no logs, webhook on', () => {
    const r = parseConfig(JSON.stringify(base));
    expect(r.ok && r.config.sources).toEqual({ inbox: { enabled: true, path: null }, log: [], webhook: { enabled: true } });
  });
  it('accepts log files and a custom inbox', () => {
    const r = parseConfig(JSON.stringify({ ...base, sources: { inbox: { enabled: false }, log: [{ path: '~/vault/log.md' }] } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.sources).toEqual({ inbox: { enabled: false, path: null }, log: [{ path: '~/vault/log.md' }], webhook: { enabled: true } });
  });
  it('rejects an unknown source key and a bad source in a rule', () => {
    expect(parseConfig(JSON.stringify({ ...base, sources: { fax: {} } })).ok).toBe(false);
    expect(parseConfig(JSON.stringify({ ...base, rules: [{ worker: 'advisor', when: { source: 'fax' } }] })).ok).toBe(false);
  });
  it('accepts source and text rule keys', () => {
    const r = parseConfig(JSON.stringify({ ...base, rules: [{ worker: 'advisor', when: { source: 'log', text: ['*brief*', '*health check*'] } }] }));
    expect(r.ok).toBe(true);
  });
});

describe('expandHome', () => {
  it('expands a leading ~', () => {
    expect(expandHome('~/vault/log.md')).toBe(join(homedir(), 'vault/log.md'));
    expect(expandHome('~')).toBe(homedir());
    expect(expandHome('C:/x/~y')).toBe('C:/x/~y');
  });
});

describe('source and text rules', () => {
  const rules: Rule[] = [
    { worker: 'advisor', when: { source: 'log', text: ['*brief*', '*health check*'] } },
    { worker: 'dev', when: { source: 'claude', tool: 'Bash' } },
  ];
  it('matches a log line by source and text, case-insensitive', () => {
    expect(matchRule(rules, { event: 'Report', session: 'log', source: 'log', status: 'note', text: '2026-11-22 | Morning BRIEF | daily/x.md' })).toEqual({ worker: 'advisor' });
  });
  it('does not match the same text from another source', () => {
    expect(matchRule(rules, { event: 'Report', session: 'i', source: 'inbox', status: 'note', text: 'morning brief' })).toBeNull();
  });
  it('treats hook events as source claude', () => {
    expect(matchRule(rules, { event: 'PreToolUse', session: 's', tool: 'Bash' })).toEqual({ worker: 'dev' });
  });
  it('a text rule never matches a hook event', () => {
    expect(matchRule([{ worker: 'a', when: { text: '*' } }], { event: 'PreToolUse', session: 's', tool: 'Bash' })).toBeNull();
  });
});
