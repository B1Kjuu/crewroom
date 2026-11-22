import type { WorkerView } from '../shared/events.js';
import { drawText, textWidth } from './font.js';
import { restSpots } from '../shared/layout.js';
import { findPath, type Point } from './path.js';
import { bakeSprite, shade } from './sprite.js';
import type { CrewFrames, SettingPack, SpriteGrid } from './settings/types.js';

const SPEED = 3; // tiles per second
const ANIM_FPS = 4;
const CREW_W = 16;
const CREW_H = 24;
const NAME = '#e6e9f2';
const LABEL = '#ff9a7f';
const BADGE = '#ffcf5c';

type Dir = 'down' | 'up' | 'left' | 'right';

interface Ent {
  view: WorkerView;
  x: number; // px, tile top-left
  y: number;
  path: Point[];
  spot: string;
  dir: Dir;
  leaving: boolean;
  hidden: boolean;
}

declare global {
  interface Window {
    __crewroom?: { workers: WorkerView[]; crew?: () => { id: string; x: number; y: number; path: number; spot: string; hidden: boolean }[] };
  }
}

export interface Office {
  update(workers: WorkerView[]): void;
  start(): void;
  /** Stops drawing and watching the window, so a new office can take the canvas. */
  destroy(): void;
}

export function createOffice(canvas: HTMLCanvasElement, pack: SettingPack): Office {
  const T = pack.tile;
  const { map } = pack;
  const W = map.w * T;
  const H = map.h * T;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  // Tiles never change: bake them once.
  const tileLayer = document.createElement('canvas');
  tileLayer.width = W;
  tileLayer.height = H;
  const tctx = tileLayer.getContext('2d')!;
  const baked = new Map<string, HTMLCanvasElement>();
  map.rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const grid = pack.tiles[ch];
      if (!grid) return;
      if (!baked.has(ch)) baked.set(ch, bakeSprite(grid, pack.palette));
      tctx.drawImage(baked.get(ch)!, x * T, y * T);
    });
  });

  const fit = () => {
    const box = canvas.parentElement!.getBoundingClientRect();
    const scale = Math.max(1, Math.floor(Math.min(box.width / W, box.height / H)));
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${H * scale}px`;
  };
  const resize = new ResizeObserver(fit);
  resize.observe(canvas.parentElement!);
  fit();

  const sprites = new Map<string, HTMLCanvasElement>();
  const spriteFor = (v: WorkerView, set: keyof CrewFrames, i: number): HTMLCanvasElement => {
    // A custom sheet still loading (or broken) draws as crew-1; key the cache by what is drawn.
    const id = pack.crew[v.sprite] ? v.sprite : Object.keys(pack.crew)[0]!;
    const frames = pack.crew[id]![set];
    const grid: SpriteGrid = frames[i % frames.length]!;
    const key = `${id}|${v.color}|${set}|${i % frames.length}`;
    let c = sprites.get(key);
    if (!c) {
      const [main, dark] = pack.uniformKeys;
      c = bakeSprite(grid, pack.palette, { [main]: v.color, [dark]: shade(v.color, 0.3) });
      sprites.set(key, c);
    }
    return c;
  };

  // Idle crew, and crew whose console isn't in this layout, each get their own waiting tile.
  const rest = restSpots(map, 16);
  const spotTile = (name: string): Point => {
    if (name.startsWith('rest-') && rest.length) return rest[Number(name.slice(5)) % rest.length]!;
    const s = map.spots[name] ?? map.spots.door!;
    return { x: s.x, y: s.y };
  };
  const waits = (v: WorkerView) => v.state === 'idle' || v.home === 'lounge' || !map.spots[v.home];
  const tileOf = (e: Ent): Point => ({ x: Math.round(e.x / T), y: Math.round(e.y / T) });

  const ents = new Map<string, Ent>();
  let latest: WorkerView[] = [];

  const targetFor = (v: WorkerView, loungeIndex: Map<string, number>): string => {
    if (v.state === 'away') return 'door';
    if (waits(v)) return `rest-${loungeIndex.get(v.id) ?? 0}`;
    return v.home;
  };

  const goTo = (e: Ent, spot: string) => {
    if (e.spot === spot && (e.path.length || !e.leaving)) return;
    e.spot = spot;
    e.path = findPath(map, tileOf(e), spotTile(spot)).slice(1);
  };

  const update = (workers: WorkerView[]) => {
    latest = workers;
    window.__crewroom = {
      workers,
      crew: () => [...ents.entries()].map(([id, e]) => ({ id, x: e.x / T, y: e.y / T, path: e.path.length, spot: e.spot, hidden: e.hidden })),
    };
    const loungers = workers.filter((w) => w.state !== 'away' && waits(w)).map((w) => w.id).sort();
    const loungeIndex = new Map(loungers.map((id, i) => [id, i]));
    const seen = new Set<string>();
    for (const v of workers) {
      seen.add(v.id);
      let e = ents.get(v.id);
      if (!e) {
        const door = spotTile('door');
        e = { view: v, x: door.x * T, y: door.y * T, path: [], spot: 'door', dir: 'up', leaving: false, hidden: v.state === 'away' };
        ents.set(v.id, e);
      }
      e.view = v;
      e.leaving = v.state === 'away';
      if (!e.leaving) e.hidden = false;
      goTo(e, targetFor(v, loungeIndex));
    }
    for (const [id, e] of ents) {
      if (seen.has(id)) continue;
      e.leaving = true;
      e.view = { ...e.view, state: 'away' };
      goTo(e, 'door');
    }
  };

  const step = (dt: number) => {
    for (const [id, e] of ents) {
      let budget = SPEED * T * dt;
      while (budget > 0 && e.path.length) {
        const next = e.path[0]!;
        const dx = next.x * T - e.x;
        const dy = next.y * T - e.y;
        const dist = Math.abs(dx) + Math.abs(dy);
        e.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
        if (dist <= budget) {
          e.x = next.x * T;
          e.y = next.y * T;
          e.path.shift();
          budget -= dist;
        } else {
          e.x += Math.sign(dx) * Math.min(Math.abs(dx), budget);
          e.y += Math.sign(dy) * Math.min(Math.abs(dy), dx === 0 ? budget : 0);
          budget = 0;
        }
      }
      if (!e.path.length && e.leaving && e.spot === 'door') {
        e.hidden = true;
        if (!latest.some((w) => w.id === id)) ents.delete(id);
      }
    }
  };

  const drawCrew = (e: Ent, t: number) => {
    const v = e.view;
    const frame = Math.floor(t * ANIM_FPS);
    const walking = e.path.length > 0;
    let set: keyof CrewFrames;
    let flip = false;
    if (walking) {
      set = e.dir === 'up' ? 'walkUp' : e.dir === 'down' ? 'walkDown' : 'walkRight';
      flip = e.dir === 'left';
    } else if (v.state === 'working' || v.state === 'waiting') {
      set = v.anim ?? 'type';
    } else {
      set = 'idle';
    }
    const img = spriteFor(v, set, frame);
    const px = Math.round(e.x);
    const py = Math.round(e.y) + T - CREW_H;
    if (flip) {
      ctx.save();
      ctx.translate(px + CREW_W, py);
      ctx.scale(-1, 1);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    } else {
      ctx.drawImage(img, px, py);
    }

    const cx = px + CREW_W / 2;
    const name = v.sessions > 1 ? `${v.name} ×${v.sessions}` : v.name;
    drawText(ctx, name, Math.round(cx - textWidth(name) / 2), py - 7, NAME);
    if (!walking && (v.state === 'working' || v.state === 'waiting') && v.label) {
      const label = v.label.length > 11 ? v.label.slice(0, 10) + '.' : v.label; // 11 chars = 43px, fits the 3-tile console gap
      drawText(ctx, label, Math.round(cx - textWidth(label) / 2), py - 13, LABEL);
    }
    if (v.state === 'waiting' && frame % 2 === 0) {
      ctx.fillStyle = BADGE;
      ctx.fillRect(px + CREW_W - 1, py + 1, 5, 7);
      drawText(ctx, '!', px + CREW_W, py + 2, '#0b0f1a', '');
    }
  };

  let last = 0;
  const loop = (ms: number) => {
    const t = ms / 1000;
    const dt = last ? Math.min(t - last, 0.5) : 0; // catch up after a throttled tab, without teleporting
    last = t;
    step(dt);
    pack.drawBackdrop(ctx, t, W, H);
    ctx.drawImage(tileLayer, 0, 0);
    [...ents.values()].filter((e) => !e.hidden).sort((a, b) => a.y - b.y).forEach((e) => drawCrew(e, t));
    if (!stopped) frameId = requestAnimationFrame(loop);
  };

  let stopped = false;
  let frameId = 0;
  return {
    update,
    start: () => {
      frameId = requestAnimationFrame(loop);
    },
    destroy: () => {
      stopped = true;
      cancelAnimationFrame(frameId);
      resize.disconnect();
    },
  };
}
