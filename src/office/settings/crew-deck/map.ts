import { BUILTIN_LAYOUT, deriveMap } from '../../../shared/layout.js';

// The built-in deck is a layout like any other; see src/shared/layout.ts for the tile chars.
export const map = deriveMap(BUILTIN_LAYOUT);
