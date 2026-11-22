import type { SettingPack } from '../types.js';
import { drawBackdrop } from './backdrop.js';
import { crew } from './crew.js';
import { map } from './map.js';
import { palette } from './palette.js';
import { tiles } from './tiles.js';

export const crewDeck: SettingPack = {
  id: 'crew-deck',
  tile: 16,
  palette,
  tiles,
  map,
  crew,
  uniformKeys: ['U', 'u'],
  drawBackdrop,
};
