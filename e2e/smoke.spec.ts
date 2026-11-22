import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_HOME } from '../playwright.config.js';

const token = () => (JSON.parse(readFileSync(join(E2E_HOME, 'bridge.json'), 'utf8')) as { token: string }).token;

test('a skill event puts the Editor to work, and Stop sends them to the lounge', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.locator('.status')).toHaveText('Live');

  const post = (body: object) => request.post('/events', { headers: { 'x-crewroom-token': token() }, data: body });

  expect((await post({ event: 'PreToolUse', session: 'e2e-1', tool: 'Skill', skill: 'b1kjuu-editor' })).status()).toBe(204);
  await expect.poll(() => page.evaluate((id) => window.__crewroom?.workers.find((w) => w.id === id)?.state, 'editor')).toBe('working');
  await expect(page.locator('.log li').first()).toContainText('b1kjuu-editor');

  await post({ event: 'Stop', session: 'e2e-1' });
  await expect.poll(() => page.evaluate((id) => window.__crewroom?.workers.find((w) => w.id === id)?.state, 'editor'), { timeout: 6000 }).toBe('idle');
});

test('a file dropped in the inbox puts the Editor to work', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.status')).toHaveText('Live');
  mkdirSync(join(E2E_HOME, 'inbox'), { recursive: true });
  writeFileSync(join(E2E_HOME, 'inbox', `${Date.now()}.txt`), 'Editor start: e2e inbox check');
  await expect.poll(() => page.evaluate((id) => window.__crewroom?.workers.find((w) => w.id === id)?.label, 'editor')).toBe('e2e inbox check');
  await expect(page.locator('.log li').first()).toContainText('e2e inbox check');
});

test('the layout editor paints a console, saves it, and goes back to the built-in deck', async ({ page }) => {
  const saved = join(E2E_HOME, 'layout.json');
  await page.goto('/');
  await expect(page.locator('.status')).toHaveText('Live');
  await page.getByRole('button', { name: 'Edit layout' }).click();
  await expect(page.locator('#office')).toBeHidden();
  await page.getByRole('radio', { name: 'Console' }).click();
  // built-in deck is 22 x 13 tiles; (14, 5) is floor
  const box = (await page.locator('.editor-canvas').boundingBox())!;
  await page.mouse.click(box.x + (14.5 / 22) * box.width, box.y + (5.5 / 13) * box.height);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.editor-status')).toContainText('Saved');
  const rows = (JSON.parse(readFileSync(saved, 'utf8')) as { rows: string[] }).rows;
  expect(rows[5]![14]).toBe('C');

  await page.getByRole('button', { name: 'Use built-in deck' }).click();
  await expect(page.locator('.editor-status')).toContainText('built-in');
  expect(existsSync(saved)).toBe(false);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('#office')).toBeVisible();
});

test('the sprite template is a 64 x 216 PNG the bridge can serve back as a custom crew sheet', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit layout' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Sprite template' }).click()]);
  expect(download.suggestedFilename()).toBe('crewroom-crew-template.png');
  const png = readFileSync(await download.path());
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([64, 216]);

  mkdirSync(join(E2E_HOME, 'sprites'), { recursive: true });
  writeFileSync(join(E2E_HOME, 'sprites', 'e2e-bot.png'), png);
  const served = await request.get('/sprites/e2e-bot.png');
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toBe('image/png');
});

test('importing a layout that is too big says why and keeps the editor working', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Edit layout' }).click();
  const huge = JSON.stringify({ rows: Array(10).fill('H'.repeat(5000)) });
  await page.locator('.editor input[type=file]').setInputFiles({ name: 'huge.json', mimeType: 'application/json', buffer: Buffer.from(huge) });
  await expect(page.locator('.editor-status')).toContainText('the most is 40');
  await expect(page.locator('.size input').first()).toHaveValue('22');
  await page.getByRole('button', { name: 'Done' }).click();
});

test('the page rejects a request without the token', async ({ request }) => {
  const r = await request.post('/events', { data: { event: 'Stop', session: 'x' } });
  expect(r.status()).toBe(401);
});
