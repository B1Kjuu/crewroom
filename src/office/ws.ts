import type { ServerMsg } from '../shared/events.js';

export type Status = 'live' | 'reconnecting';

export function connect(onMsg: (m: ServerMsg) => void, onStatus: (s: Status) => void): void {
  const token = document.querySelector<HTMLMetaElement>('meta[name="crewroom-token"]')?.content ?? '';
  let delay = 500;

  const open = () => {
    const ws = new WebSocket(`ws://${location.host}/live?token=${encodeURIComponent(token)}`);
    ws.onopen = () => {
      delay = 500;
      onStatus('live');
    };
    ws.onmessage = (e) => {
      try {
        onMsg(JSON.parse(String(e.data)) as ServerMsg);
      } catch {
        // ignore a bad frame
      }
    };
    ws.onclose = (e) => {
      if (e.code === 4001) {
        // The bridge restarted with a new token; the page has the old one.
        location.reload();
        return;
      }
      onStatus('reconnecting');
      setTimeout(open, delay);
      delay = Math.min(delay * 2, 5000);
    };
  };
  open();
}
