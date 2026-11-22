import { join } from 'node:path';
import type { OfficeConfig } from '../../shared/config-schema.js';
import type { ReportEvent } from '../../shared/events.js';
import { expandHome } from '../../shared/paths.js';
import { watchInbox } from './inbox.js';
import { watchLog } from './log.js';

export interface SourceSinks {
  emit: (ev: ReportEvent) => void;
  /** A line for the activity log, e.g. an inbox file that was dropped. */
  notice: (source: string, label: string) => void;
}

/** Starts the file-based sources a config turns on. Returns one function that stops them all. */
export function startSources(sources: OfficeConfig['sources'], home: string, sinks: SourceSinks): () => void {
  const stops: (() => void)[] = [];
  if (sources.inbox.enabled) {
    const dir = sources.inbox.path ? expandHome(sources.inbox.path) : join(home, 'inbox');
    try {
      stops.push(watchInbox(dir, sinks.emit, { onIgnored: (name, reason) => sinks.notice('inbox', `ignored ${name}: ${reason}`) }));
    } catch {
      // folder can't be created (bad path): the rest still runs
    }
  }
  for (const log of sources.log) {
    stops.push(watchLog(expandHome(log.path), sinks.emit, { onNotice: (m) => sinks.notice('log', m) }));
  }
  return () => stops.forEach((stop) => stop());
}
