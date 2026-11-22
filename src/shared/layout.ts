// Layouts are rows of tile chars. Where crew stand is worked out from the tiles, so an editor
// only paints tiles: stand below a console, in front of a sofa, enter at the door.
import { findPath } from './path.js';

export type Facing = 'up' | 'down' | 'left' | 'right';

export interface MapDef {
  w: number;
  h: number;
  /** One char per tile; each char is a key into SettingPack.tiles. */
  rows: string[];
  /** Tile chars crew can walk on. */
  walkable: string;
  /** Named tiles: console-1..8 (where a worker stands to work), lounge-1..4, door. */
  spots: Record<string, { x: number; y: number; facing: Facing }>;
}

/** H hull, W window, V strut, K cockpit dash, . floor, C console, S sofa, P plant, M coffee machine, D door. */
export const TILE_CHARS = 'HWVK.CSPMD';
const WALKABLE = '.,D';
export const LAYOUT_LIMITS = { minW: 10, maxW: 40, minH: 8, maxH: 24 };

export const BUILTIN_LAYOUT: readonly string[] = [
  'HHHHHHHHHHHHHHHHHHHHHH',
  'HWWWWVWWWWVWWWWVWWWWWH',
  'HWWWWVWWWWVWWWWVWWWWWH',
  'HKKKKKKKKKKKKKKKKKKKKH',
  'H....................H',
  'H.C..C..C..C.........H',
  'H....................H',
  'H....................H',
  'H.C..C..C..C.........H',
  'H..............PSSSSMH',
  'H....................H',
  'H....................H',
  'HHHHHHHHHHDHHHHHHHHHHH',
];

const walkable = (ch: string | undefined) => ch !== undefined && WALKABLE.includes(ch);

export function deriveMap(layout: readonly string[]): MapDef {
  // "," is the second floor plate; the editor only paints ".", the checker is applied here.
  const rows = layout.map((r, y) => [...r].map((ch, x) => (ch === '.' || ch === ',' ? ((x + y) % 2 ? ',' : '.') : ch)).join(''));
  const h = rows.length;
  const w = rows[0]?.length ?? 0;
  const spots: MapDef['spots'] = {};
  let consoles = 0;
  let lounges = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y]![x];
      const below = rows[y + 1]?.[x];
      if (ch === 'C' && consoles < 8 && walkable(below)) spots[`console-${++consoles}`] = { x, y: y + 1, facing: 'up' };
      if (ch === 'S' && lounges < 4 && walkable(below)) spots[`lounge-${++lounges}`] = { x, y: y + 1, facing: 'down' };
      if (ch === 'D' && !spots.door) spots.door = { x, y, facing: 'up' };
    }
  }
  return { w, h, rows, walkable: WALKABLE, spots };
}

/** Plain-language problems with a layout; empty means it's usable. */
export function validateLayout(layout: unknown): string[] {
  if (!Array.isArray(layout) || !layout.every((r) => typeof r === 'string')) return ['A layout is a list of text rows.'];
  const rows = layout as string[];
  const { minW, maxW, minH, maxH } = LAYOUT_LIMITS;
  const errors: string[] = [];
  if (rows.length < minH || rows.length > maxH) errors.push(`Use ${minH} to ${maxH} rows (this has ${rows.length}).`);
  const w = rows[0]?.length ?? 0;
  if (w < minW || w > maxW) errors.push(`Rows must be ${minW} to ${maxW} tiles wide (this is ${w}).`);
  rows.forEach((r, i) => {
    if (r.length !== w) errors.push(`Row ${i + 1} is ${r.length} tiles wide; the first row is ${w}.`);
  });
  const unknown = new Set([...rows.join('')].filter((ch) => ch !== ',' && !TILE_CHARS.includes(ch)));
  for (const ch of unknown) errors.push(`"${ch}" isn't a tile. Use ${[...TILE_CHARS].join(' ')}.`);
  if (errors.length) return errors;

  const map = deriveMap(rows);
  if (!map.spots.door) errors.push('Add a door (D). Crew come in through it.');
  if (!map.spots['console-1']) errors.push('Add at least one console (C) with floor below it.');
  if (errors.length) return errors;
  for (const [name, s] of Object.entries(map.spots)) {
    if (name === 'door') continue;
    if (!findPath(map, map.spots.door!, s).length) errors.push(`Crew can't reach ${name} (row ${s.y + 1}, column ${s.x + 1}) from the door.`);
  }
  return errors;
}

/**
 * Where idle crew (and crew whose console isn't in this layout) wait: the lounge spots first,
 * then the free floor tiles nearest the door, so nobody stands on top of anyone else.
 */
export function restSpots(map: MapDef, count: number): { x: number; y: number }[] {
  const lounges = Object.keys(map.spots)
    .filter((k) => k.startsWith('lounge-'))
    .sort((a, b) => Number(a.slice(7)) - Number(b.slice(7)))
    .map((k) => ({ x: map.spots[k]!.x, y: map.spots[k]!.y }));
  const out = lounges.slice(0, count);
  const door = map.spots.door;
  if (out.length >= count || !door) return out;
  const key = (x: number, y: number) => `${x},${y}`;
  const taken = new Set(Object.values(map.spots).map((s) => key(s.x, s.y)));
  const seen = new Set([key(door.x, door.y)]);
  const queue = [{ x: door.x, y: door.y }];
  while (queue.length && out.length < count) {
    const p = queue.shift()!;
    for (const [dx, dy] of [[0, -1], [1, 0], [-1, 0], [0, 1]] as const) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (seen.has(key(n.x, n.y)) || !walkable(map.rows[n.y]?.[n.x])) continue;
      seen.add(key(n.x, n.y));
      queue.push(n);
      if (!taken.has(key(n.x, n.y))) out.push(n);
    }
  }
  return out.slice(0, count);
}

/** Reads an imported layout file ({ rows } or a bare list) and refuses anything too big to draw. */
export function parseLayoutFile(text: string): { rows: string[] } | { error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "That file isn't JSON." };
  }
  const rows = Array.isArray(raw) ? raw : (raw as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows) || !rows.every((r) => typeof r === 'string')) return { error: "That file isn't a crewroom layout (no rows)." };
  const { maxW, maxH } = LAYOUT_LIMITS;
  if (rows.length > maxH) return { error: `That layout has ${rows.length} rows; the most is ${maxH}.` };
  const widest = Math.max(0, ...rows.map((r) => r.length));
  if (widest > maxW) return { error: `That layout is ${widest} tiles wide; the most is ${maxW}.` };
  return { rows: [...rows] };
}
