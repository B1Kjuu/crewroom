// The crewroom sprite sheet format, so anyone can draw their own crew in Aseprite or Photoshop.
//
// PNG, 64 x 216: four 16 x 24 frames across, nine sets down, in this order:
//   idle (2), walkDown (4), walkUp (4), walkRight (4), type (2), read (2), run (2), think (2), wait (2)
// Sets with fewer than 4 frames use the first columns. Transparent pixels are empty.
// #888888 is the uniform and #666666 its shade: both take each worker's colour.
import type { CrewFrames, SpriteGrid } from './settings/types.js';

export const SHEET = { width: 64, height: 216, frameW: 16, frameH: 24 } as const;

const SETS: [keyof CrewFrames, number][] = [
  ['idle', 2],
  ['walkDown', 4],
  ['walkUp', 4],
  ['walkRight', 4],
  ['type', 2],
  ['read', 2],
  ['run', 2],
  ['think', 2],
  ['wait', 2],
];

const UNIFORM = '#888888';
const UNIFORM_SHADE = '#666666';
// Keys are unique across every sheet loaded, because all crew share one palette.
let nextKey = 0x4e00;
const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** RGBA pixels of a sheet -> frames in the same grid format the built-in crew use. */
export function sheetToFrames(rgba: Uint8ClampedArray, width: number, height: number): { frames: CrewFrames; palette: Record<string, string> } {
  if (width !== SHEET.width || height !== SHEET.height) {
    throw new Error(`A crew sheet is ${SHEET.width} x ${SHEET.height} pixels; this one is ${width} x ${height}.`);
  }
  const palette: Record<string, string> = {};
  const keyOf = new Map<string, string>([
    [UNIFORM, 'U'],
    [UNIFORM_SHADE, 'u'],
  ]);
  const pixel = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (rgba[i + 3]! < 128) return '.';
    const hex = `#${hex2(rgba[i]!)}${hex2(rgba[i + 1]!)}${hex2(rgba[i + 2]!)}`;
    let key = keyOf.get(hex);
    if (!key) {
      // Private keys well outside the built-in palette's ASCII ones.
      key = String.fromCharCode(nextKey++);
      keyOf.set(hex, key);
      palette[key] = hex;
    }
    return key;
  };
  const frames = {} as CrewFrames;
  SETS.forEach(([set, count], row) => {
    frames[set] = Array.from({ length: count }, (_, col): SpriteGrid => ({
      w: SHEET.frameW,
      h: SHEET.frameH,
      rows: Array.from({ length: SHEET.frameH }, (_, y) =>
        Array.from({ length: SHEET.frameW }, (_, x) => pixel(col * SHEET.frameW + x, row * SHEET.frameH + y)).join(''),
      ),
    }));
  });
  return { frames, palette };
}

/** Frames -> RGBA pixels of a sheet, with the uniform drawn in the two greys. Used for the template download. */
export function templateSheet(frames: CrewFrames, palette: Record<string, string>): Uint8ClampedArray {
  const out = new Uint8ClampedArray(SHEET.width * SHEET.height * 4);
  SETS.forEach(([set], row) => {
    frames[set].slice(0, 4).forEach((grid, col) => {
      grid.rows.forEach((r, y) => {
        [...r].forEach((ch, x) => {
          if (ch === '.') return;
          const hex = ch === 'U' ? UNIFORM : ch === 'u' ? UNIFORM_SHADE : palette[ch];
          if (!hex) return;
          const i = ((row * SHEET.frameH + y) * SHEET.width + col * SHEET.frameW + x) * 4;
          out.set([parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255], i);
        });
      });
    });
  });
  return out;
}
