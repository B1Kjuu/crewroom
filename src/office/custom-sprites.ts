// Loads custom crew sheets (config "sprite": "custom:<name>") into the pack, and makes the template.
import type { WorkerView } from '../shared/events.js';
import { SHEET, sheetToFrames, templateSheet } from './sheet.js';
import type { SettingPack } from './settings/types.js';

/** A sheet that failed is tried again after this long, so adding the PNG later works without a reload. */
export const SPRITE_RETRY_MS = 15_000;

/** sprite -> 'ok' once loaded, or the time it last failed (a load in flight counts as a failure "now"). */
const seen = new Map<string, number | 'ok'>();

export function shouldLoadSprite(record: Map<string, number | 'ok'>, sprite: string, now: number): boolean {
  if (!sprite.startsWith('custom:')) return false;
  const last = record.get(sprite);
  return last === undefined || (last !== 'ok' && now - last >= SPRITE_RETRY_MS);
}

/** The last problem reported per sprite: retries stay quiet unless the reason changes. */
const said = new Map<string, string>();

export function shouldNotice(record: Map<string, string>, sprite: string, message: string): boolean {
  if (record.get(sprite) === message) return false;
  record.set(sprite, message);
  return true;
}

/** Loads any custom sheets these workers use that aren't loaded yet. Calls back once one is ready. */
export function loadCustomSprites(pack: SettingPack, workers: WorkerView[], onLoaded: () => void, onError: (msg: string) => void): void {
  for (const w of workers) {
    if (!shouldLoadSprite(seen, w.sprite, Date.now())) continue;
    seen.set(w.sprite, Date.now());
    const name = w.sprite.slice('custom:'.length);
    const img = new Image();
    img.src = `/sprites/${encodeURIComponent(name)}.png?t=${Date.now()}`;
    img
      .decode()
      .then(() => {
        // Check the size before drawing: a huge image would allocate a huge canvas.
        if (img.naturalWidth !== SHEET.width || img.naturalHeight !== SHEET.height) {
          throw new Error(`A crew sheet is ${SHEET.width} x ${SHEET.height} pixels; this one is ${img.naturalWidth} x ${img.naturalHeight}.`);
        }
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const { frames, palette } = sheetToFrames(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height);
        Object.assign(pack.palette, palette);
        pack.crew[w.sprite] = frames;
        seen.set(w.sprite, 'ok');
        said.delete(w.sprite);
        onLoaded();
      })
      .catch((e: unknown) => {
        const why = e instanceof Error && e.message.includes('crew sheet') ? e.message : "couldn't be loaded";
        const message = `Sprite ~/.crewroom/sprites/${name}.png: ${why} ${w.name} uses crew-1 until it is fixed.`;
        if (shouldNotice(said, w.sprite, message)) onError(message);
      });
  }
}

/** Downloads crew-1 laid out as a sheet, with the uniform in the two greys, to draw over. */
export function downloadTemplate(pack: SettingPack): void {
  const c = document.createElement('canvas');
  c.width = SHEET.width;
  c.height = SHEET.height;
  const rgba = templateSheet(pack.crew['crew-1']!, pack.palette);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(rgba), SHEET.width, SHEET.height), 0, 0);
  c.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'crewroom-crew-template.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); // revoking at once can cancel the download (Safari)
  }, 'image/png');
}
