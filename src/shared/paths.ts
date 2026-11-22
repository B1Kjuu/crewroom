import { homedir } from 'node:os';
import { join } from 'node:path';

export function crewroomHome(): string {
  return process.env.CREWROOM_HOME || join(homedir(), '.crewroom');
}

export function bridgeFile(): string {
  return join(crewroomHome(), 'bridge.json');
}

export function defaultConfigPath(): string {
  return join(crewroomHome(), 'office.config.json');
}

/** Expands a leading "~" to the home folder, so config paths can be written portably. */
export function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (/^~[\\/]/.test(p)) return join(homedir(), p.slice(2));
  return p;
}
