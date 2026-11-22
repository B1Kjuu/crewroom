import { describe, expect, it } from 'vitest';
import { hostAllowed, newToken, originAllowed, tokenMatches } from '../src/bridge/auth.js';

describe('auth', () => {
  it('newToken is 64 hex chars and random', () => {
    const a = newToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(newToken()).not.toBe(a);
  });

  it('tokenMatches', () => {
    const t = newToken();
    expect(tokenMatches(t, t)).toBe(true);
    expect(tokenMatches(newToken(), t)).toBe(false);
    expect(tokenMatches(t.slice(1), t)).toBe(false);
    expect(tokenMatches(undefined, t)).toBe(false);
  });

  it('hostAllowed', () => {
    expect(hostAllowed('127.0.0.1:47321', 47321)).toBe(true);
    expect(hostAllowed('localhost:47321', 47321)).toBe(true);
    expect(hostAllowed('evil.com:47321', 47321)).toBe(false);
    expect(hostAllowed('127.0.0.1:1', 47321)).toBe(false);
    expect(hostAllowed('127.0.0.1', 47321)).toBe(false);
    expect(hostAllowed(undefined, 47321)).toBe(false);
  });

  it('originAllowed', () => {
    expect(originAllowed('http://127.0.0.1:47321', 47321)).toBe(true);
    expect(originAllowed('http://localhost:47321', 47321)).toBe(true);
    expect(originAllowed('http://evil.com', 47321)).toBe(false);
    expect(originAllowed('https://127.0.0.1:47321', 47321)).toBe(false);
    expect(originAllowed(undefined, 47321)).toBe(false);
  });
});
