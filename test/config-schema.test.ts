import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseConfig } from '../src/shared/config-schema.js';
import { crewEventSchema } from '../src/shared/events.js';

const example = {
  office: { name: 'Kil crew deck', setting: 'crew-deck' },
  workers: [
    { id: 'developer', name: 'Developer', sprite: 'crew-1', color: '#e8452c', home: 'console-1' },
    { id: 'editor', name: 'Editor', sprite: 'crew-2', color: '#3aa7ff', home: 'console-2' },
  ],
  rules: [
    { worker: 'editor', when: { skill: 'b1kjuu-editor' } },
    { worker: 'editor', when: { tool: 'mcp__capcut__*' }, action: 'editing' },
    { worker: 'editor', when: { command: 'ffmpeg*' }, action: 'rendering' },
    { worker: 'developer', when: { skill: ['b1kjuu-dev', 'superpowers:*'] } },
  ],
  fallback: 'per-session',
  actions: { editing: { label: 'editing', anim: 'type' } },
  layout: null,
};

const json = (v: unknown) => JSON.stringify(v);

describe('parseConfig', () => {
  it('parses the design example', () => {
    const r = parseConfig(json(example));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.config.fallback).toBe('per-session');
  });

  it('accepts a UTF-8 BOM', () => {
    expect(parseConfig(String.fromCharCode(0xfeff) + json(example)).ok).toBe(true);
  });

  it('rejects a rule pointing at an unknown worker', () => {
    const r = parseConfig(json({ ...example, rules: [{ worker: 'ghost', when: { skill: 'x' } }] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('ghost');
  });

  it('rejects an unknown when key', () => {
    const r = parseConfig(json({ ...example, rules: [{ worker: 'editor', when: { colour: 'x' } }] }));
    expect(r.ok).toBe(false);
  });

  it('rejects an empty when', () => {
    const r = parseConfig(json({ ...example, rules: [{ worker: 'editor', when: {} }] }));
    expect(r.ok).toBe(false);
  });

  it('rejects duplicate worker ids', () => {
    const w = example.workers[0]!;
    const r = parseConfig(json({ ...example, rules: [], workers: [w, { ...w, home: 'console-3' }] }));
    expect(r.ok).toBe(false);
  });

  it('rejects duplicate homes', () => {
    const w = example.workers[0]!;
    const r = parseConfig(json({ ...example, rules: [], workers: [w, { ...w, id: 'other' }] }));
    expect(r.ok).toBe(false);
  });

  it('fallback may be a worker id', () => {
    expect(parseConfig(json({ ...example, fallback: 'developer' })).ok).toBe(true);
  });

  it('rejects a fallback id that is not a worker', () => {
    expect(parseConfig(json({ ...example, fallback: 'ghost' })).ok).toBe(false);
  });

  it('fills defaults for fallback, actions and layout', () => {
    const { fallback: _f, actions: _a, layout: _l, ...rest } = example;
    const r = parseConfig(json(rest));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.fallback).toBe('per-session');
      expect(r.config.actions).toEqual({});
      expect(r.config.layout).toBeNull();
    }
  });

  it('reports a JSON syntax error', () => {
    const r = parseConfig('{');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  });
});

describe('shipped configs', () => {
  it('examples/kil.office.config.json is valid', () => {
    const r = parseConfig(readFileSync(new URL('../examples/kil.office.config.json', import.meta.url), 'utf8'));
    expect(r.ok ? 'ok' : r.error).toBe('ok');
  });

  it('e2e/fixture.config.json is valid', () => {
    expect(parseConfig(readFileSync(new URL('../e2e/fixture.config.json', import.meta.url), 'utf8')).ok).toBe(true);
  });
});

describe('crewEventSchema', () => {
  it('accepts a trimmed event', () => {
    expect(crewEventSchema.safeParse({ event: 'PreToolUse', session: 'abc', tool: 'Bash', command: 'ls' }).success).toBe(true);
  });

  it('rejects a 201-char command', () => {
    expect(crewEventSchema.safeParse({ event: 'PreToolUse', session: 'abc', command: 'x'.repeat(201) }).success).toBe(false);
  });

  it('rejects unknown fields', () => {
    expect(crewEventSchema.safeParse({ event: 'Stop', session: 'abc', prompt: 'secret' }).success).toBe(false);
  });
});
