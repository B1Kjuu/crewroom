// Space outside the cockpit window: two star layers drifting at different speeds, and a planet.
interface Star {
  x: number;
  y: number;
}

function stars(n: number, seed: number, w: number, h: number): Star[] {
  let s = seed;
  const rand = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return Array.from({ length: n }, () => ({ x: rand() * w, y: rand() * h }));
}

let far: Star[] = [];
let near: Star[] = [];
let size = '';

export function drawBackdrop(ctx: CanvasRenderingContext2D, t: number, w: number, h: number): void {
  if (size !== `${w}x${h}`) {
    size = `${w}x${h}`;
    far = stars(70, 7, w, h);
    near = stars(28, 99, w, h);
  }
  ctx.fillStyle = '#05070f';
  ctx.fillRect(0, 0, w, h);

  // planet, slowest layer
  const px = Math.round(w - ((t * 2) % (w + 60)));
  const py = 30;
  for (let dy = -9; dy <= 9; dy++) {
    for (let dx = -9; dx <= 9; dx++) {
      if (dx * dx + dy * dy > 81) continue;
      ctx.fillStyle = dx + dy > 4 ? '#3b2a4f' : dx * dx + dy * dy > 49 ? '#7a4b8c' : '#9a63ad';
      ctx.fillRect(px + dx, py + dy, 1, 1);
    }
  }

  ctx.fillStyle = '#4a5578';
  for (const s of far) ctx.fillRect(Math.round((s.x - t * 4 + w * 100) % w), Math.round(s.y), 1, 1);
  for (const s of near) {
    const x = Math.round((s.x - t * 12 + w * 100) % w);
    ctx.fillStyle = '#c9d4ff';
    ctx.fillRect(x, Math.round(s.y), 1, 1);
    ctx.fillStyle = '#4a5578';
    ctx.fillRect(x + 1, Math.round(s.y), 1, 1);
  }
}
