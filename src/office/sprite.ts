import type { SpriteGrid } from './settings/types.js';

export function validateGrid(grid: SpriteGrid): void {
  if (grid.rows.length !== grid.h) throw new Error(`grid has ${grid.rows.length} rows, expected ${grid.h}`);
  grid.rows.forEach((r, i) => {
    if (r.length !== grid.w) throw new Error(`grid row ${i} is ${r.length} wide, expected ${grid.w}`);
  });
}

export function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.round(v * (1 - amount)).toString(16).padStart(2, '0');
  return '#' + ch((n >> 16) & 255) + ch((n >> 8) & 255) + ch(n & 255);
}

export function bakeSprite(grid: SpriteGrid, palette: Record<string, string>, swap: Record<string, string> = {}): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = grid.w;
  c.height = grid.h;
  const ctx = c.getContext('2d')!;
  grid.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const k = row[x]!;
      if (k === '.') continue;
      const color = swap[k] ?? palette[k];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  return c;
}
