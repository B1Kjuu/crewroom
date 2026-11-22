import { describe, expect, it } from 'vitest';
import { SHEET, sheetToFrames, templateSheet } from '../src/office/sheet.js';
import { crewDeck } from '../src/office/settings/crew-deck/index.js';
import { parseConfig } from '../src/shared/config-schema.js';
import type { CrewFrames } from '../src/office/settings/types.js';

const SETS = ['idle', 'walkDown', 'walkUp', 'walkRight', 'type', 'read', 'run', 'think', 'wait'] as const;

/** Colour of every pixel of every frame, with the uniform keys kept as U/u so worker colours still apply. */
const colours = (frames: CrewFrames, palette: Record<string, string>) =>
  SETS.map((set) =>
    frames[set].map((g) => g.rows.map((r) => [...r].map((ch) => (ch === '.' ? '.' : ch === 'U' || ch === 'u' ? ch : palette[ch])).join('|'))),
  );

describe('sprite sheets', () => {
  it('is 64 x 216: 4 frames of 16 x 24 across, 9 sets down', () => {
    expect(SHEET).toMatchObject({ width: 64, height: 216, frameW: 16, frameH: 24 });
  });

  it('a template read back gives the same crew', () => {
    const crew1 = crewDeck.crew['crew-1']!;
    const rgba = templateSheet(crew1, crewDeck.palette);
    expect(rgba.length).toBe(64 * 216 * 4);
    const { frames, palette } = sheetToFrames(rgba, 64, 216);
    expect(colours(frames, palette)).toEqual(colours(crew1, crewDeck.palette));
  });

  it('grey #888888 and #666666 become the uniform keys', () => {
    const rgba = new Uint8ClampedArray(64 * 216 * 4);
    const put = (x: number, y: number, hex: string) => {
      const i = (y * 64 + x) * 4;
      rgba.set([parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255], i);
    };
    put(0, 0, '#888888');
    put(1, 0, '#666666');
    put(2, 0, '#ff0000');
    const { frames, palette } = sheetToFrames(rgba, 64, 216);
    const row = frames.idle[0]!.rows[0]!;
    expect(row.slice(0, 2)).toBe('Uu');
    expect(palette[row[2]!]).toBe('#ff0000');
    expect(row[3]).toBe('.');
  });

  it('two sheets never share colour keys, so one cannot repaint the other', () => {
    const one = (hex: string) => {
      const rgba = new Uint8ClampedArray(64 * 216 * 4);
      rgba.set([parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255], 0);
      return sheetToFrames(rgba, 64, 216).palette;
    };
    const a = one('#ff0000');
    const b = one('#00ff00');
    expect(Object.keys(a).filter((k) => k in b)).toEqual([]);
  });

  it('frame counts match the built-in crew', () => {
    const { frames } = sheetToFrames(new Uint8ClampedArray(64 * 216 * 4), 64, 216);
    expect(SETS.map((s) => frames[s].length)).toEqual([2, 4, 4, 4, 2, 2, 2, 2, 2]);
  });

  it('refuses a sheet of the wrong size', () => {
    expect(() => sheetToFrames(new Uint8ClampedArray(32 * 24 * 4), 32, 24)).toThrow(/64 x 216/);
  });

  it('config accepts custom:<name> sprites and rejects odd names', () => {
    const cfg = (sprite: string) =>
      JSON.stringify({
        office: { name: 'D', setting: 'crew-deck' },
        workers: [{ id: 'a', name: 'A', sprite, color: '#e8452c', home: 'console-1' }],
      });
    expect(parseConfig(cfg('custom:my-bot')).ok).toBe(true);
    expect(parseConfig(cfg('custom:../x')).ok).toBe(false);
    expect(parseConfig(cfg('custom:')).ok).toBe(false);
  });
});
