import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { parseConfig } from '../shared/config-schema.js';

export function watchConfig(path: string, onChange: (r: ReturnType<typeof parseConfig>) => void): () => void {
  // Watch the folder, not the file: editors often save by replacing the file.
  const name = basename(path);
  let timer: NodeJS.Timeout | undefined;
  let last = '';
  const watcher = watch(dirname(path), (_event, file) => {
    if (file && file !== name) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch {
        return; // mid-save or deleted; wait for the next change
      }
      if (text === last) return;
      last = text;
      onChange(parseConfig(text));
    }, 100);
  });
  watcher.on('error', () => {});
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
