export interface SpriteGrid {
  w: number;
  h: number;
  /** One char per pixel; "." is transparent, anything else is a palette key. */
  rows: string[];
}

export type { Facing, MapDef } from '../../shared/layout.js';
import type { MapDef } from '../../shared/layout.js';

export interface CrewFrames {
  idle: SpriteGrid[];
  walkDown: SpriteGrid[];
  walkUp: SpriteGrid[];
  /** Left is drawn mirrored. */
  walkRight: SpriteGrid[];
  type: SpriteGrid[];
  read: SpriteGrid[];
  run: SpriteGrid[];
  think: SpriteGrid[];
  wait: SpriteGrid[];
}

export interface SettingPack {
  id: string;
  tile: 16;
  palette: Record<string, string>;
  tiles: Record<string, SpriteGrid>;
  map: MapDef;
  crew: Record<string, CrewFrames>;
  /** Palette keys swapped for each worker's colour: [main, shade]. */
  uniformKeys: [main: string, shade: string];
  /** Paints what is behind the tiles (stars outside the window). t in seconds. */
  drawBackdrop(ctx: CanvasRenderingContext2D, t: number, w: number, h: number): void;
}
