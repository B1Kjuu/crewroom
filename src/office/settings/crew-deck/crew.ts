// Crew sprites, 16x24, drawn as parts (head 0-9, body 10-17, legs 18-23) and composed.
// Template chars: A hair, S skin, E eyes, U/u uniform, k belt, B boots, W badge, o shadow.
import type { CrewFrames, SpriteGrid } from '../types.js';

type Rows = string[];

const head = {
  short: {
    front: ['................', '......AAAA......', '.....AAAAAA.....', '....AAAAAAAA....', '....AASSSSAA....', '....ASSSSSSA....', '....SSESSESS....', '....SSSSSSSS....', '.....SSSSSS.....', '......SSSS......'],
    back: ['................', '......AAAA......', '.....AAAAAA.....', '....AAAAAAAA....', '....AAAAAAAA....', '....AAAAAAAA....', '....AAAAAAAA....', '....SAAAAAAS....', '.....SSSSSS.....', '......SSSS......'],
    side: ['................', '.......AAAA.....', '......AAAAAA....', '.....AAAAAAAA...', '.....AAAASSSS...', '.....AAASSSSS...', '.....AAASSSES...', '.....AASSSSSSS..', '......SSSSSS....', '.......SSSS.....'],
  },
  long: {
    front: ['................', '......AAAA......', '.....AAAAAA.....', '....AAAAAAAA....', '....AASSSSAA....', '...AASSSSSSAA...', '...ASSESSESSA...', '...ASSSSSSSSA...', '...AASSSSSSAA...', '....A.SSSS.A....'],
    back: ['................', '......AAAA......', '.....AAAAAA.....', '....AAAAAAAA....', '...AAAAAAAAAA...', '...AAAAAAAAAA...', '...AAAAAAAAAA...', '...AAAAAAAAAA...', '...AAAAAAAAAA...', '....AAAAAAAA....'],
    side: ['................', '.......AAAA.....', '......AAAAAA....', '.....AAAAAAAA...', '....AAAAASSSS...', '....AAAASSSSS...', '....AAAASSSES...', '....AAASSSSSSS..', '....AASSSSSS....', '....AA.SSSS.....'],
  },
};

const body = {
  front: ['....UUUUUUUU....', '...UUUUUUWUUU...', '...UUUUUUUUUU...', '...UuUUUUUUuU...', '...UuUUUUUUuU...', '...SuUUUUUUuS...', '....kkkkkkkk....', '....UUUUUUUU....'],
  back: ['....UUUUUUUU....', '...UUUUUUUUUU...', '...UUUUUUUUUU...', '...UuUUUUUUuU...', '...UuUUUUUUuU...', '...SuUUUUUUuS...', '....kkkkkkkk....', '....UUUUUUUU....'],
  side: ['......UUUUUU....', '.....UUUUUUUU...', '.....UUUUUUUU...', '.....UUuUUUUU...', '.....UUuUUUUU...', '.....UUSUUUUU...', '......kkkkkkk...', '......UUUUUU....'],
};

const legs = {
  stand: ['....UUUuuUUU....', '....UUU..UUU....', '....UUU..UUU....', '....uuu..uuu....', '....BBB..BBB....', '...oooooooooo...'],
  stepL: ['....UUUuuUUU....', '....UUU..UUU....', '....UUU..UUU....', '....uuu..BBB....', '....BBB..ooo....', '...oooooooooo...'],
  stepR: ['....UUUuuUUU....', '....UUU..UUU....', '....UUU..UUU....', '....BBB..uuu....', '....ooo..BBB....', '...oooooooooo...'],
  sideA: ['......UUUUUU....', '.......UUUU.....', '.......UUUU.....', '.......uuuu.....', '.......BBBBB....', '.....oooooooo...'],
  sideB: ['......UUUUUU....', '......UU..UU....', '.....UU....UU...', '.....uu....uu...', '....BBB....BBB..', '...oooooooooooo.'],
};

const set = (rows: Rows, x: number, y: number, ch: string): Rows =>
  rows.map((r, i) => (i === y ? r.slice(0, x) + ch + r.slice(x + 1) : r));
const edits = (rows: Rows, list: [number, number, string][]): Rows => list.reduce((r, [x, y, ch]) => set(r, x, y, ch), rows);

const compose = (...parts: Rows[]): Rows => parts.flat();
const bob = (rows: Rows): Rows => ['................', ...rows.slice(0, 9), ...rows.slice(10)];

interface Look {
  hair: 'short' | 'long';
  hairKey: string;
  skinKey: string;
}

function framesFor(look: Look): CrewFrames {
  const h = head[look.hair];
  const paint = (rows: Rows): SpriteGrid => ({
    w: 16,
    h: 24,
    rows: rows.map((r) => r.replace(/A/g, look.hairKey).replace(/S/g, look.skinKey)),
  });

  const front = compose(h.front, body.front, legs.stand);
  const blink = edits(front, [[6, 6, 'S'], [9, 6, 'S']]);
  const back = compose(h.back, body.back, legs.stand);
  const side = (l: Rows) => compose(h.side, body.side, l);

  // At the console the crew face away from us, hands up on the desk.
  const handsUp = edits(back, [[3, 15, 'U'], [12, 15, 'U'], [3, 12, 'S'], [12, 12, 'S']]);
  const handsAlt = edits(back, [[3, 15, 'U'], [12, 15, 'U'], [3, 12, 'S'], [12, 13, 'S']]);
  const waveA = edits(front, [[12, 15, 'U'], [13, 10, 'U'], [13, 9, 'U'], [13, 8, 'S']]);
  const waveB = edits(front, [[12, 15, 'U'], [13, 10, 'U'], [13, 9, 'U'], [14, 7, 'S'], [13, 8, 'U']]);

  return {
    idle: [paint(front), paint(blink)],
    walkDown: [paint(front), paint(compose(h.front, body.front, legs.stepL)), paint(front), paint(compose(h.front, body.front, legs.stepR))],
    walkUp: [paint(back), paint(compose(h.back, body.back, legs.stepL)), paint(back), paint(compose(h.back, body.back, legs.stepR))],
    walkRight: [paint(side(legs.sideA)), paint(side(legs.sideB)), paint(side(legs.sideA)), paint(side(legs.sideB))],
    type: [paint(handsUp), paint(handsAlt)],
    read: [paint(back), paint(bob(back))],
    run: [paint(edits(handsUp, [[12, 0, 'Y']])), paint(edits(handsAlt, [[3, 0, 'Y'], [4, 0, 'R']]))],
    think: [paint(edits(back, [[12, 1, 'W']])), paint(edits(back, [[12, 1, 'W'], [13, 0, 'W']]))],
    wait: [paint(waveA), paint(waveB)],
  };
}

const looks: Look[] = [
  { hair: 'short', hairKey: 't', skinKey: '2' },
  { hair: 'long', hairKey: 'l', skinKey: '1' },
  { hair: 'short', hairKey: 'h', skinKey: '3' },
  { hair: 'short', hairKey: 't', skinKey: '4' },
  { hair: 'long', hairKey: 'i', skinKey: '1' },
  { hair: 'short', hairKey: 's', skinKey: '3' },
  { hair: 'long', hairKey: 'h', skinKey: '2' },
  { hair: 'long', hairKey: 'i', skinKey: '4' },
];

export const crew: Record<string, CrewFrames> = Object.fromEntries(looks.map((l, i) => [`crew-${i + 1}`, framesFor(l)]));
