import { describe, expect, it } from 'vitest';
import { findPath } from '../src/office/path.js';
import type { MapDef } from '../src/office/settings/types.js';

const map = (rows: string[]): MapDef => ({ w: rows[0]!.length, h: rows.length, rows, walkable: '.', spots: {} });

describe('findPath', () => {
  it('walks a straight line', () => {
    expect(findPath(map(['....']), { x: 0, y: 0 }, { x: 3, y: 0 })).toEqual([
      { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 },
    ]);
  });

  it('goes around a wall', () => {
    const p = findPath(map(['.#.', '...']), { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(p).toHaveLength(5);
    expect(p.some((s) => s.x === 1 && s.y === 0)).toBe(false);
    expect(p.at(-1)).toEqual({ x: 2, y: 0 });
  });

  it('may end on a non-walkable target such as a console seat', () => {
    expect(findPath(map(['..C']), { x: 0, y: 0 }, { x: 2, y: 0 }).at(-1)).toEqual({ x: 2, y: 0 });
  });

  it('returns [] when unreachable', () => {
    expect(findPath(map(['.#.']), { x: 0, y: 0 }, { x: 2, y: 0 })).toEqual([]);
  });

  it('returns [from] when already there', () => {
    expect(findPath(map(['..']), { x: 1, y: 0 }, { x: 1, y: 0 })).toEqual([{ x: 1, y: 0 }]);
  });
});
