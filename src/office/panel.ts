import type { LogEntry } from '../shared/events.js';
import type { Status } from './ws.js';

const MAX_ROWS = 200;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour12: false });

export function createPanel(root: HTMLElement, names: () => Map<string, string>) {
  const status = el('p', 'status', 'Connecting…');
  status.setAttribute('role', 'status');
  const error = el('pre', 'config-error');
  error.hidden = true;
  const heading = el('h2', 'log-title', 'Activity');
  const empty = el('p', 'empty', 'No activity yet. Run "crewroom hooks install", then start a Claude Code session.');
  const list = el('ol', 'log');
  root.append(status, error, heading, empty, list);

  const row = (e: LogEntry) => {
    const li = el('li');
    li.append(
      el('time', 'when', time(e.t)),
      el('span', 'who', names().get(e.worker) ?? e.worker),
      el('span', 'what', e.label ?? e.event),
    );
    li.title = [e.event, e.tool].filter(Boolean).join(' · ');
    return li;
  };

  const refresh = () => {
    empty.hidden = list.childElementCount > 0;
  };

  return {
    setStatus(s: Status) {
      status.textContent = s === 'live' ? 'Live' : 'Reconnecting…';
      status.dataset.state = s;
    },
    setError(e: string | null) {
      error.hidden = e === null;
      error.textContent = e === null ? '' : `Config problem, still using the last good config:\n${e}`;
    },
    addLog(e: LogEntry) {
      list.prepend(row(e));
      while (list.childElementCount > MAX_ROWS) list.lastElementChild!.remove();
      refresh();
    },
    setLog(entries: LogEntry[]) {
      list.replaceChildren(...entries.slice(-MAX_ROWS).reverse().map(row));
      refresh();
    },
  };
}
