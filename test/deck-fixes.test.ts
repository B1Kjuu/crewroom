import { describe, expect, it } from 'vitest';
import { shouldLoadSprite, shouldNotice, SPRITE_RETRY_MS } from '../src/office/custom-sprites.js';
import { BUILTIN_LAYOUT, parseLayoutFile } from '../src/shared/layout.js';

describe('custom sprite retries', () => {
  it('loads a new sheet, skips one that loaded, and retries a failed one after a while', () => {
    const seen = new Map<string, number | 'ok'>();
    expect(shouldLoadSprite(seen, 'custom:bot', 0)).toBe(true);
    seen.set('custom:bot', 'ok');
    expect(shouldLoadSprite(seen, 'custom:bot', 99_999)).toBe(false);
    seen.set('custom:bad', 1000);
    expect(shouldLoadSprite(seen, 'custom:bad', 1000 + SPRITE_RETRY_MS - 1)).toBe(false);
    expect(shouldLoadSprite(seen, 'custom:bad', 1000 + SPRITE_RETRY_MS)).toBe(true);
  });

  it('reports a failure once, and again only if the reason changes', () => {
    const said = new Map<string, string>();
    expect(shouldNotice(said, 'custom:bot', 'missing')).toBe(true);
    expect(shouldNotice(said, 'custom:bot', 'missing')).toBe(false);
    expect(shouldNotice(said, 'custom:bot', 'wrong size')).toBe(true);
  });

  it('never tries built-in sprites', () => {
    expect(shouldLoadSprite(new Map(), 'crew-1', 0)).toBe(false);
  });
});

describe('parseLayoutFile (import)', () => {
  it('accepts { rows } and a bare list', () => {
    expect(parseLayoutFile(JSON.stringify({ setting: 'crew-deck', rows: BUILTIN_LAYOUT }))).toEqual({ rows: [...BUILTIN_LAYOUT] });
    expect(parseLayoutFile(JSON.stringify(BUILTIN_LAYOUT))).toEqual({ rows: [...BUILTIN_LAYOUT] });
  });

  it('refuses what the editor cannot draw, with a reason', () => {
    expect(parseLayoutFile('{oops')).toHaveProperty('error');
    expect(parseLayoutFile('{"rows": [1, 2]}')).toHaveProperty('error');
    const wide = parseLayoutFile(JSON.stringify(['H'.repeat(5000), ...Array(9).fill('H'.repeat(5000))]));
    expect('error' in wide && wide.error).toMatch(/40/);
    const tall = parseLayoutFile(JSON.stringify(Array(500).fill('H'.repeat(12))));
    expect('error' in tall && tall.error).toMatch(/24/);
  });
});
