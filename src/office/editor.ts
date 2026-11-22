// Layout editor: paint tiles, see where crew will stand, save to the bridge.
import { BUILTIN_LAYOUT, deriveMap, LAYOUT_LIMITS, parseLayoutFile, validateLayout } from '../shared/layout.js';
import { drawText } from './font.js';
import { bakeSprite } from './sprite.js';
import type { SettingPack } from './settings/types.js';

const TILES: [ch: string, label: string][] = [
  ['.', 'Floor'],
  ['H', 'Wall'],
  ['W', 'Window'],
  ['V', 'Strut'],
  ['K', 'Dash'],
  ['C', 'Console'],
  ['S', 'Sofa'],
  ['P', 'Plant'],
  ['M', 'Coffee'],
  ['D', 'Door'],
];

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const token = () => document.querySelector<HTMLMetaElement>('meta[name="crewroom-token"]')?.content ?? '';

export interface EditorHooks {
  pack: () => SettingPack;
  current: () => string[] | null;
  /** Extra buttons other features add (e.g. the sprite template download). */
  extras?: HTMLElement[];
}

export function createEditor(panel: HTMLElement, officeCanvas: HTMLElement, hooks: EditorHooks) {
  const open = el('button', 'btn', 'Edit layout');
  open.type = 'button';
  const box = el('section', 'editor');
  box.hidden = true;
  box.setAttribute('aria-label', 'Layout editor');
  panel.prepend(open, box);

  const canvas = el('canvas', 'editor-canvas');
  canvas.hidden = true;
  canvas.setAttribute('aria-label', 'Layout being edited: click or drag to paint the chosen tile');
  officeCanvas.after(canvas);

  let draft: string[] = [];
  let brush = '.';
  const swatches = new Map<string, HTMLButtonElement>();

  // palette
  const palette = el('div', 'palette');
  palette.setAttribute('role', 'radiogroup');
  palette.setAttribute('aria-label', 'Tile');
  for (const [ch, label] of TILES) {
    const b = el('button', 'swatch');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.title = label;
    const icon = el('canvas');
    icon.width = 16;
    icon.height = 16;
    b.append(icon, el('span', '', label));
    b.addEventListener('click', () => pick(ch));
    swatches.set(ch, b);
    palette.append(b);
  }
  const pick = (ch: string) => {
    brush = ch;
    for (const [c, b] of swatches) b.setAttribute('aria-checked', String(c === ch));
  };

  // size
  const size = el('div', 'size');
  const num = (label: string, min: number, max: number) => {
    const wrap = el('label', '', `${label} `);
    const input = el('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    wrap.append(input);
    size.append(wrap);
    return input;
  };
  const wIn = num('Width', LAYOUT_LIMITS.minW, LAYOUT_LIMITS.maxW);
  const hIn = num('Height', LAYOUT_LIMITS.minH, LAYOUT_LIMITS.maxH);
  const resize = () => {
    const w = Math.min(LAYOUT_LIMITS.maxW, Math.max(LAYOUT_LIMITS.minW, Number(wIn.value) || 0));
    const h = Math.min(LAYOUT_LIMITS.maxH, Math.max(LAYOUT_LIMITS.minH, Number(hIn.value) || 0));
    draft = Array.from({ length: h }, (_, y) => (draft[y] ?? '').padEnd(w, '.').slice(0, w));
    render();
  };
  wIn.addEventListener('change', resize);
  hIn.addEventListener('change', resize);

  const problems = el('ul', 'problems');
  problems.setAttribute('aria-live', 'polite');
  const status = el('p', 'editor-status');
  status.setAttribute('role', 'status');

  const button = (label: string, cls = 'btn') => {
    const b = el('button', cls, label);
    b.type = 'button';
    return b;
  };
  const save = button('Save', 'btn primary');
  const reset = button('Use built-in deck');
  const exportBtn = button('Export');
  const importBtn = button('Import');
  const done = button('Done');
  const file = el('input');
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.hidden = true;

  const actions = el('div', 'actions');
  actions.append(save, reset, exportBtn, importBtn, ...(hooks.extras ?? []), done, file);
  box.append(el('p', 'hint', 'Pick a tile, then click or drag on the deck. Crew stand below consoles and in front of sofas, and come in at the door.'), palette, size, problems, actions, status);

  let paintingDown = false;
  const tileAt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * canvas.width / 16);
    const y = Math.floor(((e.clientY - r.top) / r.height) * canvas.height / 16);
    return { x, y };
  };
  const paint = (e: PointerEvent) => {
    const { x, y } = tileAt(e);
    const row = draft[y];
    if (row === undefined || x < 0 || x >= row.length || row[x] === brush) return;
    draft[y] = row.slice(0, x) + brush + row.slice(x + 1);
    render();
  };
  canvas.addEventListener('pointerdown', (e) => {
    paintingDown = true;
    canvas.setPointerCapture(e.pointerId);
    paint(e);
  });
  canvas.addEventListener('pointermove', (e) => paintingDown && paint(e));
  // Stop painting however the pointer goes away (a touch cancel would otherwise leave the brush on).
  for (const end of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    canvas.addEventListener(end, () => (paintingDown = false));
  }

  const baked = new Map<string, HTMLCanvasElement>();
  const tileImg = (pack: SettingPack, ch: string) => {
    if (!baked.has(ch) && pack.tiles[ch]) baked.set(ch, bakeSprite(pack.tiles[ch]!, pack.palette));
    return baked.get(ch);
  };

  function render() {
    const pack = hooks.pack();
    const map = deriveMap(draft);
    canvas.width = map.w * 16;
    canvas.height = map.h * 16;
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#05070f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    map.rows.forEach((row, y) => [...row].forEach((ch, x) => {
      const img = tileImg(pack, ch);
      if (img) ctx.drawImage(img, x * 16, y * 16);
    }));
    // where crew will stand
    for (const [name, s] of Object.entries(map.spots)) {
      const tag = name === 'door' ? 'IN' : name.startsWith('console') ? name.slice(8) : 'L';
      ctx.fillStyle = name === 'door' ? '#ffcf5c' : name.startsWith('console') ? '#e8452c' : '#c86bd6';
      ctx.fillRect(s.x * 16 + 3, s.y * 16 + 4, 10, 8);
      drawText(ctx, tag, s.x * 16 + 8 - tag.length * 2, s.y * 16 + 5, '#0b0f1a', '');
    }
    // fit like the office: whole pixels only
    const box = canvas.parentElement!.getBoundingClientRect();
    const scale = Math.max(1, Math.floor(Math.min(box.width / canvas.width, box.height / canvas.height)));
    canvas.style.width = `${canvas.width * scale}px`;
    canvas.style.height = `${canvas.height * scale}px`;
    wIn.value = String(map.w);
    hIn.value = String(map.h);
    for (const [ch, b] of swatches) {
      const icon = b.querySelector('canvas')!;
      const img = tileImg(pack, ch === '.' ? '.' : ch);
      const ictx = icon.getContext('2d')!;
      ictx.clearRect(0, 0, 16, 16);
      if (img) ictx.drawImage(img, 0, 0);
    }
    const errors = validateLayout(draft);
    problems.replaceChildren(...errors.map((m) => el('li', '', m)));
    save.disabled = errors.length > 0;
  }

  const setOpen = (on: boolean) => {
    box.hidden = !on;
    canvas.hidden = !on;
    officeCanvas.hidden = on;
    open.hidden = on;
    panel.classList.toggle('editing', on);
    if (on) {
      draft = [...(hooks.current() ?? BUILTIN_LAYOUT)];
      status.textContent = '';
      pick(brush);
      render();
    }
  };

  const post = async (rows: string[] | null) => {
    status.textContent = 'Saving…';
    try {
      const r = await fetch('/layout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-crewroom-token': token() },
        body: JSON.stringify({ rows }),
      });
      if (r.ok) {
        status.textContent = rows ? 'Saved. The deck now uses this layout.' : 'Back to the built-in deck.';
        return true;
      }
      const body = (await r.json().catch(() => null)) as { errors?: string[] } | null;
      status.textContent = body?.errors?.join(' ') ?? `Couldn't save (${r.status}).`;
    } catch {
      status.textContent = "Couldn't reach the bridge. Is crewroom still running?";
    }
    return false;
  };

  open.addEventListener('click', () => setOpen(true));
  done.addEventListener('click', () => setOpen(false));
  save.addEventListener('click', () => void post(draft));
  reset.addEventListener('click', async () => {
    if (await post(null)) {
      draft = [...BUILTIN_LAYOUT];
      render();
    }
  });
  exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ setting: 'crew-deck', rows: draft }, null, 2) + '\n'], { type: 'application/json' });
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'crewroom-layout.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000); // revoking at once can cancel the download (Safari)
  });
  importBtn.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files?.[0];
    file.value = '';
    if (!f) return;
    const parsed = parseLayoutFile(await f.text());
    if ('error' in parsed) {
      status.textContent = `${f.name}: ${parsed.error}`;
      return;
    }
    draft = parsed.rows;
    status.textContent = `Loaded ${f.name}. Save to use it.`;
    render();
  });
  window.addEventListener('resize', () => !box.hidden && render());

  return { isOpen: () => !box.hidden };
}
