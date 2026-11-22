import type { SpriteGrid } from '../types.js';

const grid = (rows: string[]): SpriteGrid => ({ w: 16, h: 16, rows });

const floor = (base: string): SpriteGrid =>
  grid(
    Array.from({ length: 16 }, (_, y) =>
      Array.from({ length: 16 }, (_, x) => (x === 15 || y === 15 ? 'q' : x === 2 && y === 2 ? 'q' : base)).join(''),
    ),
  );

const hull = grid([
  '8888888888888888',
  '0000000000000000',
  '0000000000000000',
  '000r00000000r000',
  '0000000000000000',
  '0000000000000000',
  '0000000000000000',
  '0000000000000000',
  '0000000000000000',
  '0000000000000000',
  '0000000000000000',
  '0000000000000000',
  '000r00000000r000',
  '0000000000000000',
  '0000000000000000',
  '9999999999999999',
]);

const glass = grid(Array.from({ length: 16 }, () => '................'));

const strut = grid(Array.from({ length: 16 }, () => '......0880......'));

const dash = grid([
  '8888888888888888',
  '0000000000000000',
  '9999999999999999',
  'xxxxxxxxxxxxxxxx',
  'xzzzzxxxxxzzzzzx',
  'xzyzzxxGxxzzyyzx',
  'xzzyzxxxxxzyzzzx',
  'xzzzzxxRxxzzzzzx',
  'xxxxxxxxxxxxxxxx',
  'xxYxxxGxxxxRxxxx',
  'xxxxxxxxxxxxxxxx',
  'cccccccccccccccc',
  'cccccccccccccccc',
  'xxxxxxxxxxxxxxxx',
  '9999999999999999',
  'qqqqqqqqqqqqqqqq',
]);

const console_ = grid([
  'fffffffffffffffq',
  'fffffffffffffffq',
  'ffxxxxxxxxxxxxfq',
  'ffxzzzzzzzzzzxfq',
  'ffxzyyzzyzzzzxfq',
  'ffxzzzzyyyzzzxfq',
  'ffxzyyyzzzzyzxfq',
  'ffxzzzzzzzzzzxfq',
  'ffxxxxxxxxxxxxfq',
  'fcccccccccccccfq',
  'fcNNNNNNNNNNNcfq',
  'fcccRccccccYccfq',
  'fxxxxxxxxxxxxxfq',
  'ffxffffffffffxfq',
  'ffxffffffffffxfq',
  'qqqqqqqqqqqqqqqq',
]);

const sofa = grid([
  'fffffffffffffffq',
  'fffffffffffffffq',
  'fffffffffffffffq',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'pppppppppppppppp',
  'mmmmmmmmmmmmmmmm',
  'pppppppmpppppppp',
  'pppppppmpppppppp',
  'pppppppmpppppppp',
  'pppppppmpppppppp',
  'mmmmmmmmmmmmmmmm',
  'xxxxxxxxxxxxxxxx',
  'fxxffffffffffxxq',
  'qqqqqqqqqqqqqqqq',
]);

const plant = grid([
  'fffffffffffffffq',
  'ffffffLLffffffff',
  'ffffLLGGLLffffff',
  'fffLGGLLGGLfffff',
  'ffLGGLGGLGGLffff',
  'fffLGGGGGGLLffff',
  'ffLGGLGGLGGGLfff',
  'fffLLGGGGLLfffff',
  'fffffLLLLfffffff',
  'ffffnnnnnnffffff',
  'fffffnnnnfffffff',
  'fffffnnnnfffffff',
  'ffffffnnffffffff',
  'fffffxxxxxffffff',
  'fffffffffffffffq',
  'qqqqqqqqqqqqqqqq',
]);

const machine = grid([
  'fffffffffffffffq',
  'fffNNNNNNNNNNffq',
  'fffNMMMMMMMMNffq',
  'fffNMxxxxxxMNffq',
  'fffNMxyyyyxMNffq',
  'fffNMxxxxxxMNffq',
  'fffNMMMMMMMMNffq',
  'fffNMMMNNMMMNffq',
  'fffNMMN..NMMNffq',
  'fffNMMNWWNMMNffq',
  'fffNMMNWWNMMNffq',
  'fffNMMMNNMMMNffq',
  'fffNMRMMMMYMNffq',
  'fffNNNNNNNNNNffq',
  'fffxxxxxxxxxxffq',
  'qqqqqqqqqqqqqqqq',
]);

const door = grid([
  'YxYxYxYxYxYxYxYx',
  '00jjjjjjjjjjjj00',
  '00jjjjjjjjjjjj00',
  '00jjjjjNNjjjjj00',
  '00jjjjjNNjjjjj00',
  '00jjjjjNNjjjjj00',
  '00jjjjjNNjjjjj00',
  '00jjjjjNNjjjjj00',
  '00jjjjjNNjjjjj00',
  '00jjjjjNNjjjjj00',
  '00jjjjjNNjjjjj00',
  '00jjjjjNNjjjjj00',
  '00jjjjjNNjjjjj00',
  '00jjjjjjjjjjjj00',
  '00jjjjjjjjjjjj00',
  '9999999999999999',
]);

// Map chars -> tiles. "." and "," are the two floor plates; both walkable.
export const tiles: Record<string, SpriteGrid> = {
  H: hull,
  W: glass,
  V: strut,
  K: dash,
  '.': floor('f'),
  ',': floor('g'),
  C: console_,
  S: sofa,
  P: plant,
  M: machine,
  D: door,
};
