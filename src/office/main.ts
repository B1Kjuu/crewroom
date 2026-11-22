import type { WorkerView } from '../shared/events.js';
import { deriveMap } from '../shared/layout.js';
import { downloadTemplate, loadCustomSprites } from './custom-sprites.js';
import { createEditor } from './editor.js';
import { lighting } from './lighting.js';
import { createPanel } from './panel.js';
import { createOffice, type Office } from './render.js';
import { createOffice3D, type Office3D } from './render3d.js';
import { pack as builtin } from './settings/index.js';
import type { SettingPack } from './settings/types.js';
import { connect } from './ws.js';

type View = '2d' | '3d';

const stage = document.getElementById('stage')!;
const canvas2d = document.getElementById('office') as HTMLCanvasElement;
const canvas3d = document.getElementById('office3d') as HTMLCanvasElement;
const workers = new Map<string, WorkerView>();
const panel = createPanel(document.getElementById('panel')!, () => new Map([...workers.values()].map((w) => [w.id, w.name])));

const readView = (): View => {
  try {
    return localStorage.getItem('crewroom-view') === '2d' ? '2d' : '3d';
  } catch {
    return '3d';
  }
};
let view: View = readView();
let layoutKey = 'builtin';
let layoutRows: string[] | null = null;
let pack: SettingPack = builtin;
let office: Office & Partial<Pick<Office3D, 'resetView' | 'follow' | 'onFollowChange'>>;

/** (Re)builds the office for the current view and layout; crew re-enter through the door. */
function build() {
  office?.destroy();
  canvas2d.hidden = view !== '2d';
  canvas3d.hidden = view !== '3d';
  try {
    office = view === '3d' ? createOffice3D(canvas3d, pack) : createOffice(canvas2d, pack);
  } catch (e) {
    // No WebGL (old GPU, remote desktop): fall back to the 2D deck, and say why.
    console.warn('crewroom: 3D view unavailable, using 2D', e);
    view = '2d';
    canvas3d.hidden = true;
    canvas2d.hidden = false;
    office = createOffice(canvas2d, pack);
  }
  office.start();
  office.update([...workers.values()]);
  office.onFollowChange?.((id) => (followSelect.value = id ?? ''));
  followSelect.value = '';
  viewButton.textContent = view === '3d' ? '2D view' : '3D view';
  resetButton.hidden = followSelect.hidden = view !== '3d';
}

const push = () => {
  const list = [...workers.values()];
  office.update(list);
  fillFollow(list);
  loadCustomSprites(builtin, list, push, (label) => panel.addLog({ t: Date.now(), worker: 'sprites', event: 'Report', label }));
};

// View toolbar on the deck.
const tools = document.createElement('div');
tools.className = 'view-tools';
const viewButton = document.createElement('button');
viewButton.type = 'button';
viewButton.className = 'btn';
viewButton.addEventListener('click', () => {
  view = view === '3d' ? '2d' : '3d';
  try {
    localStorage.setItem('crewroom-view', view);
  } catch {
    // private window: the choice lasts until reload
  }
  build();
});
const resetButton = document.createElement('button');
resetButton.type = 'button';
resetButton.className = 'btn';
resetButton.textContent = 'Reset view';
resetButton.title = 'Drag to turn, scroll to zoom, right-drag to move';
resetButton.addEventListener('click', () => office.resetView?.());
// Follow a crewmember (3D): pick here, or click them on the deck. Esc goes back to the whole deck.
const followSelect = document.createElement('select');
followSelect.className = 'follow-select';
followSelect.setAttribute('aria-label', 'Follow a crewmember');
followSelect.addEventListener('change', () => office.follow?.(followSelect.value || null));
const fillFollow = (list: WorkerView[]) => {
  const current = followSelect.value;
  const options = [['', 'Follow: everyone'], ...list.filter((w) => w.state !== 'away' || !w.generic).map((w) => [w.id, `Follow: ${w.name}`])];
  const key = JSON.stringify(options);
  if (followSelect.dataset.key !== key) {
    followSelect.dataset.key = key;
    followSelect.replaceChildren(...options.map(([value, label]) => Object.assign(document.createElement('option'), { value, textContent: label })));
  }
  followSelect.value = options.some(([v]) => v === current) ? current : '';
};
fillFollow([]);
window.addEventListener('keydown', (e) => e.key === 'Escape' && office.follow?.(null));
tools.append(followSelect, viewButton, resetButton);
stage.parentElement!.append(tools);

build();

// Day and night by your clock: the whole deck dims and cools at night, warms at dawn and dusk.
const applyLighting = () => {
  const l = lighting(new Date().getHours());
  stage.style.filter = l.filter;
  stage.dataset.phase = l.phase;
};
applyLighting();
setInterval(applyLighting, 60_000);

const template = document.createElement('button');
template.type = 'button';
template.className = 'btn';
template.textContent = 'Sprite template';
template.title = 'Download a crew sheet to draw your own crew (PNG, 64 x 216)';
template.addEventListener('click', () => downloadTemplate(builtin));

createEditor(document.getElementById('panel')!, stage, { pack: () => builtin, current: () => layoutRows, extras: [template] });

function useLayout(rows: string[] | null | undefined) {
  const key = rows ? JSON.stringify(rows) : 'builtin';
  if (key === layoutKey) return;
  layoutKey = key;
  layoutRows = rows ?? null;
  pack = rows ? { ...builtin, map: deriveMap(rows) } : builtin;
  build();
}

connect(
  (m) => {
    if (m.type === 'snapshot') {
      workers.clear();
      for (const w of m.workers) workers.set(w.id, w);
      document.title = `${m.office.name} · crewroom`;
      panel.setError(m.configError);
      panel.setLog(m.log);
      useLayout(m.layout);
      push();
    } else if (m.type === 'worker') {
      workers.set(m.worker.id, m.worker);
      push();
    } else if (m.type === 'remove') {
      workers.delete(m.id);
      push();
    } else if (m.type === 'log') {
      panel.addLog(m.entry);
    }
  },
  (s) => panel.setStatus(s),
);
