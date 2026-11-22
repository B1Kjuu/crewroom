import { describe, expect, it } from 'vitest';
import { crewDeck } from '../src/office/settings/crew-deck/index.js';
import { findPath } from '../src/office/path.js';
import { validateGrid } from '../src/office/sprite.js';
import type { CrewFrames } from '../src/office/settings/types.js';

const keys = new Set([...Object.keys(crewDeck.palette), ...crewDeck.uniformKeys, '.']);
const counts: Record<keyof CrewFrames, number> = {
  idle: 2, walkDown: 4, walkUp: 4, walkRight: 4, type: 2, read: 2, run: 2, think: 2, wait: 2,
};

describe('crew deck pack', () => {
  it('every tile is a valid 16x16 grid of palette keys', () => {
    for (const [name, g] of Object.entries(crewDeck.tiles)) {
      expect(() => validateGrid(g), name).not.toThrow();
      expect([g.w, g.h], name).toEqual([16, 16]);
      for (const ch of g.rows.join('')) expect(keys.has(ch), `${name}: ${ch}`).toBe(true);
    }
  });

  it('has 8 crew with the right frame counts, each frame 16x24 of palette keys', () => {
    expect(Object.keys(crewDeck.crew).sort()).toEqual(['crew-1', 'crew-2', 'crew-3', 'crew-4', 'crew-5', 'crew-6', 'crew-7', 'crew-8']);
    for (const [id, frames] of Object.entries(crewDeck.crew)) {
      for (const [set, n] of Object.entries(counts)) {
        const list = frames[set as keyof CrewFrames];
        expect(list, `${id}.${set}`).toHaveLength(n);
        for (const g of list) {
          expect(() => validateGrid(g), `${id}.${set}`).not.toThrow();
          expect([g.w, g.h], `${id}.${set}`).toEqual([16, 24]);
          for (const ch of g.rows.join('')) expect(keys.has(ch), `${id}.${set}: ${ch}`).toBe(true);
        }
      }
    }
  });

  it('crew look different from each other', () => {
    const fronts = Object.values(crewDeck.crew).map((f) => f.idle[0]!.rows.join(''));
    expect(new Set(fronts).size).toBe(8);
  });

  it('uses the uniform keys so worker colours swap in', () => {
    const [main, dark] = crewDeck.uniformKeys;
    const px = crewDeck.crew['crew-1']!.idle[0]!.rows.join('');
    expect(px).toContain(main);
    expect(px).toContain(dark);
  });

  it('map rows are all map.w wide and use known tiles', () => {
    const { map } = crewDeck;
    expect(map.rows).toHaveLength(map.h);
    for (const r of map.rows) {
      expect(r).toHaveLength(map.w);
      for (const ch of r) expect(crewDeck.tiles[ch], ch).toBeDefined();
    }
  });

  it('has all spots on walkable tiles, and every one is reachable from the door', () => {
    const { map } = crewDeck;
    const names = [...Array.from({ length: 8 }, (_, i) => `console-${i + 1}`), ...Array.from({ length: 4 }, (_, i) => `lounge-${i + 1}`), 'door'];
    for (const n of names) {
      const s = map.spots[n];
      expect(s, n).toBeDefined();
      expect(map.walkable.includes(map.rows[s!.y]![s!.x]!), n).toBe(true);
      expect(findPath(map, map.spots.door!, s!).length, n).toBeGreaterThan(0);
    }
  });

  it('keeps consoles at least 3 tiles apart so name labels do not collide', () => {
    const c = Array.from({ length: 8 }, (_, i) => crewDeck.map.spots[`console-${i + 1}`]!);
    for (const a of c) for (const b of c) if (a !== b && a.y === b.y) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(3);
  });
});
