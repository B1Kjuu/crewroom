import { describe, expect, it } from 'vitest';
import { shade, validateGrid } from '../src/office/sprite.js';
import { GLYPHS, textWidth } from '../src/office/font.js';

describe('sprite helpers', () => {
  it('shade darkens each channel', () => {
    expect(shade('#e8452c', 0.25)).toBe('#ae3421');
    expect(shade('#ffffff', 0)).toBe('#ffffff');
    expect(shade('#808080', 1)).toBe('#000000');
  });

  it('validateGrid accepts a well-formed grid', () => {
    expect(() => validateGrid({ w: 2, h: 2, rows: ['..', '.#'] })).not.toThrow();
  });

  it('validateGrid rejects ragged rows and wrong height', () => {
    expect(() => validateGrid({ w: 2, h: 2, rows: ['..', '.'] })).toThrow();
    expect(() => validateGrid({ w: 2, h: 3, rows: ['..', '..'] })).toThrow();
  });
});

describe('pixel font', () => {
  it('has every glyph at 3x5', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,:-×!?_ ') {
      const g = GLYPHS[ch];
      expect(g, ch).toBeDefined();
      expect(g!.length, ch).toBe(5);
      for (const row of g!) expect(row, ch).toMatch(/^[.#]{3}$/);
    }
  });

  it('measures text at 4px per glyph minus the last gap', () => {
    expect(textWidth('ABC')).toBe(11);
    expect(textWidth('')).toBe(0);
  });
});
