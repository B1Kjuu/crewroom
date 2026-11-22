import type { WorkerView } from '../shared/events.js';
import { deriveMap } from '../shared/layout.js';
import { downloadTemplate, loadCustomSprites } from './custom-sprites.js';
import { createEditor } from './editor.js';
import { createPanel } from './panel.js';
import { createOffice, type Office } from './render.js';
import { pack as builtin } from './settings/index.js';
import type { SettingPack } from './settings/types.js';
import { connect } from './ws.js';

const canvas = document.getElementById('office') as HTMLCanvasElement;
const workers = new Map<string, WorkerView>();
const panel = createPanel(document.getElementById('panel')!, () => new Map([...workers.values()].map((w) => [w.id, w.name])));

let layoutKey = 'builtin';
let layoutRows: string[] | null = null;
let pack: SettingPack = builtin;
let office: Office = createOffice(canvas, pack);
office.start();

const push = () => {
  const list = [...workers.values()];
  office.update(list);
  loadCustomSprites(builtin, list, push, (label) => panel.addLog({ t: Date.now(), worker: 'sprites', event: 'Report', label }));
};

const template = document.createElement('button');
template.type = 'button';
template.className = 'btn';
template.textContent = 'Sprite template';
template.title = 'Download a crew sheet to draw your own crew (PNG, 64 x 216)';
template.addEventListener('click', () => downloadTemplate(builtin));

createEditor(document.getElementById('panel')!, canvas, { pack: () => builtin, current: () => layoutRows, extras: [template] });

/** Rebuilds the office when the saved layout changes; crew re-enter through the door. */
function useLayout(rows: string[] | null | undefined) {
  const key = rows ? JSON.stringify(rows) : 'builtin';
  if (key === layoutKey) return;
  layoutKey = key;
  layoutRows = rows ?? null;
  pack = rows ? { ...builtin, map: deriveMap(rows) } : builtin;
  office.destroy();
  office = createOffice(canvas, pack);
  office.start();
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
