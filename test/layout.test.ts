import { describe, expect, it } from 'vitest';
import { BUILTIN_LAYOUT, deriveMap, restSpots, validateLayout } from '../src/shared/layout.js';
import { findPath } from '../src/shared/path.js';
import { map as builtinMap } from '../src/office/settings/crew-deck/map.js';

describe('restSpots (where idle or console-less crew wait)', () => {
  it('uses the lounge spots first', () => {
    const m = deriveMap(BUILTIN_LAYOUT);
    expect(restSpots(m, 4)).toEqual([16, 17, 18, 19].map((x) => ({ x, y: 10 })));
  });

  it('without a sofa, gives distinct reachable floor tiles that are not the door or a console spot', () => {
    const noSofa = [
      'HHHHHHHHHHHH',
      'HWWWWWWWWWWH',
      'HKKKKKKKKKKH',
      'H..........H',
      'H.C..C.....H',
      'H..........H',
      'H..........H',
      'HHHHHDHHHHHH',
    ];
    const m = deriveMap(noSofa);
    const spots = restSpots(m, 6);
    expect(spots).toHaveLength(6);
    const keys = spots.map((p) => `${p.x},${p.y}`);
    expect(new Set(keys).size).toBe(6);
    const taken = Object.values(m.spots).map((s) => `${s.x},${s.y}`);
    for (const k of keys) expect(taken).not.toContain(k);
    for (const p of spots) expect(findPath(m, m.spots.door!, p).length).toBeGreaterThan(0);
  });
});

const small = [
  'HHHHHHHHHHHH',
  'HWWWWWWWWWWH',
  'HKKKKKKKKKKH',
  'H..........H',
  'H.C..C..SS.H',
  'H..........H',
  'H..........H',
  'HHHHHDHHHHHH',
];

describe('deriveMap', () => {
  it('rebuilds the built-in deck exactly (the phase 1 hand-written spots)', () => {
    const m = deriveMap(BUILTIN_LAYOUT);
    expect(m).toEqual(builtinMap);
    const xs = [2, 5, 8, 11];
    const expected = {
      ...Object.fromEntries(xs.map((x, i) => [`console-${i + 1}`, { x, y: 6, facing: 'up' }])),
      ...Object.fromEntries(xs.map((x, i) => [`console-${i + 5}`, { x, y: 9, facing: 'up' }])),
      ...Object.fromEntries([16, 17, 18, 19].map((x, i) => [`lounge-${i + 1}`, { x, y: 10, facing: 'down' }])),
      door: { x: 10, y: 12, facing: 'up' },
    };
    expect(m.spots).toEqual(expected);
    expect([m.w, m.h, m.walkable]).toEqual([22, 13, '.,D']);
  });

  it('puts console spots below consoles, top-left first, and lounge spots below sofas', () => {
    const m = deriveMap(small);
    expect(m.spots['console-1']).toEqual({ x: 2, y: 5, facing: 'up' });
    expect(m.spots['console-2']).toEqual({ x: 5, y: 5, facing: 'up' });
    expect(m.spots['console-3']).toBeUndefined();
    expect(m.spots['lounge-1']).toEqual({ x: 8, y: 5, facing: 'down' });
    expect(m.spots['lounge-2']).toEqual({ x: 9, y: 5, facing: 'down' });
    expect(m.spots.door).toEqual({ x: 5, y: 7, facing: 'up' });
  });

  it('applies the two-plate floor checker and treats "," as floor', () => {
    const m = deriveMap(small.map((r) => r.replace(/\./g, ',')));
    expect(m.rows).toEqual(deriveMap(small).rows);
    expect(m.rows[3]![1]).toBe('.');
    expect(m.rows[3]![2]).toBe(',');
  });
});

describe('validateLayout', () => {
  it('accepts the built-in and a small valid deck', () => {
    expect(validateLayout(BUILTIN_LAYOUT)).toEqual([]);
    expect(validateLayout(small)).toEqual([]);
  });

  it('rejects ragged rows, unknown tiles and bad sizes', () => {
    expect(validateLayout([...small.slice(0, 3), 'H..H', ...small.slice(4)]).join()).toMatch(/row 4/i);
    expect(validateLayout(small.map((r, i) => (i === 3 ? 'H....X.....H' : r))).join()).toMatch(/"X"/);
    expect(validateLayout(small.slice(0, 5)).join()).toMatch(/8 to 24 rows/);
    expect(validateLayout(small.map((r) => r.slice(0, 8))).join()).toMatch(/10 to 40/);
  });

  it('needs a door and a console', () => {
    expect(validateLayout(small.map((r) => r.replace('D', 'H'))).join()).toMatch(/door/i);
    expect(validateLayout(small.map((r) => r.replace(/C/g, '.'))).join()).toMatch(/console/i);
  });

  it('needs every spot reachable from the door', () => {
    const walled = small.map((r, i) => (i === 6 ? 'HHHHHHHHHHHH' : r));
    expect(validateLayout(walled).join()).toMatch(/can't reach/i);
  });

  it('rejects things that are not a list of strings', () => {
    expect(validateLayout('nope' as unknown as string[]).length).toBeGreaterThan(0);
    expect(validateLayout([1, 2] as unknown as string[]).length).toBeGreaterThan(0);
  });
});
