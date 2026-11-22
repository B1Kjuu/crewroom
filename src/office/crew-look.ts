// How a crewmember looks right now: which frame, which name and label. Shared by the 2D and 3D views.
import type { WorkerView } from '../shared/events.js';
import { facing, type ActivityKind, type CrewEnt } from './crew-motion.js';
import { drawText, textWidth } from './font.js';
import { bakeSprite, shade } from './sprite.js';
import type { CrewFrames, SettingPack, SpriteGrid } from './settings/types.js';

export const ANIM_FPS = 4;
export const CREW_W = 16;
export const CREW_H = 24;
const NAME = '#e6e9f2';
const LABEL = '#ff9a7f';
const BADGE = '#ffcf5c';
const NOTE = '#a3acc6';

/** What idle crew look like they are doing, and the little note above them. */
const ACTIVITY_LOOK: Record<ActivityKind, { set: keyof CrewFrames; note: string }> = {
  coffee: { set: 'think', note: 'coffee' },
  plants: { set: 'type', note: 'plants' },
  window: { set: 'read', note: 'stars' },
  sofa: { set: 'idle', note: 'break' },
  chat: { set: 'think', note: '...' },
  sleep: { set: 'idle', note: 'zz' },
};

export const noteFor = (e: CrewEnt): string | undefined =>
  !e.path.length && e.activity && (e.view.state === 'idle' || e.view.state === 'away') ? ACTIVITY_LOOK[e.activity.kind].note : undefined;

declare global {
  interface Window {
    __crewroom?: { workers: WorkerView[]; view?: '2d' | '3d'; crew?: () => { id: string; x: number; y: number; path: number; spot: string; hidden: boolean }[] };
  }
}

/** Frame set and index for this moment. cameraYaw 0 is the 2D view. */
export function frameFor(e: CrewEnt, t: number, cameraYaw: number): { set: keyof CrewFrames; index: number; flip: boolean } {
  const index = Math.floor(t * ANIM_FPS);
  if (e.path.length) {
    const f = facing(e.move, cameraYaw);
    return { set: f.set, index, flip: f.flip };
  }
  const v = e.view;
  if (v.state === 'working' || v.state === 'waiting') return { set: v.anim ?? 'type', index, flip: false };
  if (e.activity) return { set: ACTIVITY_LOOK[e.activity.kind].set, index: e.activity.kind === 'sleep' ? 0 : index, flip: false };
  return { set: 'idle', index, flip: false };
}

/** Baked sprite canvases, one per sprite + colour + frame. A sheet still loading draws as crew-1. */
export function createSpriteCache(pack: SettingPack) {
  const cache = new Map<string, HTMLCanvasElement>();
  return (v: WorkerView, set: keyof CrewFrames, i: number): HTMLCanvasElement => {
    const id = pack.crew[v.sprite] ? v.sprite : Object.keys(pack.crew)[0]!;
    const frames = pack.crew[id]![set];
    const grid: SpriteGrid = frames[i % frames.length]!;
    const key = `${id}|${v.color}|${set}|${i % frames.length}`;
    let c = cache.get(key);
    if (!c) {
      const [main, dark] = pack.uniformKeys;
      c = bakeSprite(grid, pack.palette, { [main]: v.color, [dark]: shade(v.color, 0.3) });
      cache.set(key, c);
    }
    return c;
  };
}

/** Name, task label and the "!" for waiting, drawn centred on cx above a sprite whose top is at top. */
export function drawTags(ctx: CanvasRenderingContext2D, v: WorkerView, cx: number, top: number, walking: boolean, frame: number, note?: string): void {
  const name = v.sessions > 1 ? `${v.name} ×${v.sessions}` : v.name;
  drawText(ctx, name, Math.round(cx - textWidth(name) / 2), top - 7, NAME);
  if (!walking && (v.state === 'working' || v.state === 'waiting') && v.label) {
    const label = v.label.length > 11 ? v.label.slice(0, 10) + '.' : v.label; // 11 chars = 43px, fits the 3-tile console gap
    drawText(ctx, label, Math.round(cx - textWidth(label) / 2), top - 13, LABEL);
  } else if (note) {
    drawText(ctx, note, Math.round(cx - textWidth(note) / 2), top - 13, NOTE);
  }
  if (v.state === 'waiting' && frame % 2 === 0) {
    ctx.fillStyle = BADGE;
    ctx.fillRect(cx + CREW_W / 2 - 1, top + 1, 5, 7);
    drawText(ctx, '!', cx + CREW_W / 2, top + 2, '#0b0f1a', '');
  }
}

export function exposeDebug(workers: WorkerView[], view: '2d' | '3d', ents: Map<string, CrewEnt>): void {
  window.__crewroom = {
    workers,
    view,
    crew: () => [...ents.entries()].map(([id, e]) => ({ id, x: e.x, y: e.y, path: e.path.length, spot: e.spot, hidden: e.hidden })),
  };
}

/** The ship drone (16 x 12, two frames: its red light blinks) and a skill drone (8 x 8). */
export const DRONE_FRAMES: SpriteGrid[] = [true, false].map((lit) => ({
  w: 16,
  h: 12,
  rows: [
    '................',
    '.....NNNNNN.....',
    '....NMMMMMMN....',
    '...NMMMMMMMMN...',
    '..NMMxxxxxxMMN..',
    '..NMxyyxxyyxMN..',
    '..NMMxxxxxxMMN..',
    '...NMMMMMMMMN...',
    lit ? '....NNMRRMNN....' : '....NNMxxMNN....',
    '.....N....N.....',
    '................',
    '................',
  ],
}));
export const SKILL_DRONE: SpriteGrid = {
  w: 8,
  h: 8,
  rows: ['..YYYY..', '.YWWWWY.', 'YWYYYYWY', 'YYYxxYYY', 'YYYxxYYY', 'YWYYYYWY', '.YWWWWY.', '..YYYY..'],
};
