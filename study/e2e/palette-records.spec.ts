import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Page } from '../../../apps/e2e/tests/fixtures.ts';
import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';
import { RUN_TMP } from '../../../apps/e2e/tests/hosts.ts';

// Step 64: record groups in the palette. `study.searchRecords` is the public record source; canned route answers cover
// counts > 3, async arrival into an empty list, and source failure without touching external mail fixtures.
const palette = (page: Page) => page.getByRole('dialog', { name: 'Comandi' });

async function openPalette(page: Page) {
  await page.goto('/desk');
  await page.getByRole('button', { name: 'Cerca o esegui, scorciatoia Ctrl K' }).click();
  await expect(palette(page).getByRole('combobox')).toBeFocused();
  await expect(palette(page).getByRole('option', { name: /Avvia Pomodoro/ })).toBeVisible();
}

const answer = (data: unknown) => ({ json: [{ result: { data } }] });
const fail = {
  status: 500,
  json: [{ error: { message: 'boom', code: -32603, data: { code: 'INTERNAL_SERVER_ERROR' } } }],
};
const studyRow = (key: string, title: string) => ({ key, g: 1, title, subject: 'p:a', done: false });
const headers = [{ id: 'p', title: 'Corso', subjects: [{ id: 'a', name: 'Chimica' }] }];

test('palette waits for two characters before searching records and caps groups to 3 rows', async ({ page }) => {
  const asked: string[] = [];
  await page.route('**/trpc/study.searchRecords*', (route) => {
    asked.push(route.request().url());
    return route.fulfill(
      answer({
        total: 5,
        headers,
        rows: [studyRow('p/1', 'Uno'), studyRow('p/2', 'Due'), studyRow('p/3', 'Tre'), studyRow('p/4', 'Quattro')],
      }),
    );
  });
  await openPalette(page);
  const field = palette(page).getByRole('combobox');
  await field.fill('u');
  await page.waitForTimeout(500);
  expect(asked).toEqual([]);
  await field.fill('un');
  const studio = palette(page).getByRole('group', { name: /Studio/ });
  await expect(studio.getByRole('option')).toHaveCount(3);
  expect(asked).toHaveLength(1);
  await expect(studio).toContainText('5');
});

test('records that arrive into an empty list leave it at the top, the first heading in view', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.route('**/trpc/study.searchRecords*', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await route.fulfill(
      answer({
        total: 3,
        headers,
        rows: [studyRow('p/1', 'Qzx uno'), studyRow('p/2', 'Qzx due'), studyRow('p/3', 'Qzx tre')],
      }),
    );
  });
  await openPalette(page);
  // No action matches "qzx": the list is empty until Studio answers.
  await palette(page).getByRole('combobox').fill('qzx');
  await expect(
    palette(page)
      .getByRole('group', { name: /Studio/ })
      .getByRole('option'),
  ).toHaveCount(3);
  await page.waitForTimeout(600);
  const scrollTop = await palette(page)
    .getByRole('listbox')
    .evaluate((list) => list.closest('.overflow-y-auto')?.scrollTop);
  expect(scrollTop).toBe(0);
});

test('a source that fails leaves the actions intact with no error row', async ({ page }) => {
  await page.route('**/trpc/study.searchRecords*', (route) => route.fulfill(fail));
  await openPalette(page);
  await palette(page).getByRole('combobox').fill('pom');
  await expect(palette(page).getByRole('group', { name: 'Azioni' }).getByRole('option').first()).toBeVisible();
  await expect(palette(page).getByRole('group', { name: /Studio/ })).toHaveCount(0);
  await expect(palette(page)).not.toContainText(/boom|non riuscita/i);
});

test('a day title found in Studio shows under Studio with its subject', async ({ page, pc }) => {
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  db.prepare("DELETE FROM progress WHERE plan_id IN ('example', '*')").run();
  db.prepare("DELETE FROM preferences WHERE plan_id = '*'").run();
  db.close();
  const inbox = join(RUN_TMP, 'study', 'in-arrivo');
  await mkdir(inbox, { recursive: true });
  await copyFile(new URL('../fixtures/example.json', import.meta.url), join(inbox, 'example.json'));
  expect((await pc.post('/trpc/study.activate', { data: { name: 'example.json' } })).ok()).toBe(true);
  try {
    await openPalette(page);
    await palette(page).getByRole('combobox').fill('FOGLIA');
    const studio = palette(page).getByRole('group', { name: /Studio/ });
    await expect(studio.getByRole('option')).toHaveCount(1);
    await expect(studio.getByRole('option', { name: /G1 · La foglia/ })).toContainText('Botanica');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/desk\/studio\?tab=piano$/);
    await expect(palette(page)).not.toBeVisible();
  } finally {
    // Back to a desk with no active plan: other specs read the Studio page as it is without one.
    await pc.post('/trpc/study.setPlan', { data: { id: 'example', active: false } });
  }
});
