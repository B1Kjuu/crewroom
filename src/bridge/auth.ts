import { randomBytes, timingSafeEqual } from 'node:crypto';

export function newToken(): string {
  return randomBytes(32).toString('hex');
}

export function tokenMatches(given: string | undefined, token: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function hostAllowed(host: string | undefined, port: number): boolean {
  return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
}

export function originAllowed(origin: string | undefined, port: number): boolean {
  if (!origin?.startsWith('http://')) return false;
  return hostAllowed(origin.slice('http://'.length), port);
}
