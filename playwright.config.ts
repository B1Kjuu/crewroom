import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const E2E_PORT = 47399;
export const E2E_HOME = join(tmpdir(), 'crewroom-e2e');

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    // Use an installed browser instead of downloading one: Edge ships with Windows.
    channel: process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome'),
  },
  webServer: {
    command: `node bin/crewroom.js start --port ${E2E_PORT} --no-open --config e2e/fixture.config.json`,
    url: `http://127.0.0.1:${E2E_PORT}`,
    env: { CREWROOM_HOME: E2E_HOME },
    reuseExistingServer: false,
  },
});
