// The 2D deck: a flat canvas, tiles baked once, crew drawn on top.
import type { WorkerView } from '../shared/events.js';
import { CREW_H, CREW_W, DRONE_FRAMES, SKILL_DRONE, createSpriteCache, drawTags, exposeDebug, frameFor, noteFor } from './crew-look.js';
import { createCrewMotion } from './crew-motion.js';
import { bakeSprite } from './sprite.js';
import type { SettingPack } from './settings/types.js';

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

  const spriteFor = createSpriteCache(pack);
  const droneImgs = DRONE_FRAMES.map((g) => bakeSprite(g, pack.palette));
  const skillImg = bakeSprite(SKILL_DRONE, pack.palette);
  const motion = createCrewMotion(map);

  const update = (workers: WorkerView[]) => {
    motion.update(workers);
    exposeDebug(workers, '2d', motion.ents);
  };

  const loop = (ms: number) => {
    const t = ms / 1000;
    const dt = last ? Math.min(t - last, 0.5) : 0; // catch up after a throttled tab, without teleporting
    last = t;
    motion.step(dt);
    pack.drawBackdrop(ctx, t, W, H);
    ctx.drawImage(tileLayer, 0, 0);
    const crew = [...motion.ents.values()].filter((e) => !e.hidden).sort((a, b) => a.y - b.y);
    for (const e of crew) {
      const f = frameFor(e, t, 0);
      const img = spriteFor(e.view, f.set, f.index);
      const px = Math.round(e.x * T);
      const py = Math.round(e.y * T) + T - CREW_H;
      if (f.flip) {
        ctx.save();
        ctx.translate(px + CREW_W, py);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0);
        ctx.restore();
      } else {
        ctx.drawImage(img, px, py);
      }
      drawTags(ctx, e.view, px + CREW_W / 2, py, e.path.length > 0, f.index, noteFor(e));
      if (e.view.skill && (e.view.state === 'working' || e.view.state === 'waiting')) {
        ctx.drawImage(skillImg, px + CREW_W - 2 + Math.round(Math.cos(t * 1.6) * 3), py + 2 + Math.round(Math.sin(t * 4)));
      }
    }
    const d = motion.drone;
    ctx.drawImage(droneImgs[Math.floor(t * 2) % 2]!, Math.round(d.x * T), Math.round(d.y * T) - 4 + Math.round(Math.sin(t * 3) * 1.5));
    if (!stopped) frameId = requestAnimationFrame(loop);
  };

  let last = 0;
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
