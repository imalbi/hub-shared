import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { APIRequestContext, Page } from '../../../apps/e2e/tests/fixtures.ts';
import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';
import { RUN_TMP } from '../../../apps/e2e/tests/hosts.ts';
import { clean, setPlan } from './calendar-data.ts';
import { legibleDay, legiblePlan } from './study-fixtures.ts';

const json = { 'content-type': 'application/json' };
const widget = (page: Page) => page.locator('[data-widget="study"]');
const panel = (page: Page) => widget(page).locator('section').first();

async function placeStudy(pc: APIRequestContext, size: 'small' | 'medium' | 'large') {
  await pc.post('/trpc/layout.save', {
    data: { zone: 'overview', items: [{ widget: 'study', size, x: 0, y: 0 }] },
    headers: json,
  });
}

async function seedStudy(
  pc: APIRequestContext,
  doneCount: number,
  { eightSteps = false }: { eightSteps?: boolean } = {},
) {
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  db.prepare("DELETE FROM progress WHERE plan_id IN ('example', '*')").run();
  db.close();
  const plan = await legiblePlan();
  if (eightSteps) {
    const day = {
      ...legibleDay,
      blocks: [
        ...legibleDay.blocks.slice(0, 2).map((block) => ({
          ...block,
          steps: block.steps.map((step) => ({
            file: { path: 'dispensa.pdf', page: 1 },
            ...step,
          })),
        })),
        {
          ...legibleDay.blocks[2],
          steps: [
            ...legibleDay.blocks[2].steps.map((step) => ({
              file: { path: 'dispensa.pdf', page: 2 },
              ...step,
            })),
            { id: 'A01.c.2', text: 'Controlla il formulario finale.', file: { path: 'dispensa.pdf', page: 4 } },
            { id: 'A01.c.3', text: 'Segna gli esercizi da ripassare.' },
          ],
        },
      ],
    };
    plan.days = [day, ...plan.days.slice(1)];
  }
  const inbox = join(RUN_TMP, 'study', 'in-arrivo');
  await mkdir(inbox, { recursive: true });
  await writeFile(join(inbox, 'legible.json'), JSON.stringify(plan));
  expect((await pc.post('/trpc/study.activate', { data: { name: 'legible.json' } })).ok()).toBe(true);
  const ids = ['A01.m.1', 'A01.m.2', 'A01.p.1', 'A01.p.2', 'A01.p.3', 'A01.c.1'];
  for (const id of ids.slice(0, doneCount))
    await pc.post('/trpc/study.setStep', { data: { key: 'example/A01', id, done: true }, headers: json });
}

test.afterEach(async ({ pc }) => {
  await clean(pc);
  await pc.post('/trpc/pomodoro.stop', { data: {}, headers: json });
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  db.prepare("DELETE FROM progress WHERE plan_id IN ('example', '*')").run();
  db.prepare("DELETE FROM preferences WHERE plan_id = '*'").run();
  db.close();
});

test('A1 & W2: Piccolo shows step count and opens Studio; Medio names next open step and toggles PDF button', async ({
  page,
  pc,
}) => {
  await seedStudy(pc, 2);
  await placeStudy(pc, 'small');
  await page.goto('/desk');
  const small = panel(page);
  await expect(small.getByText('G1 · Botanica')).toBeVisible();
  await expect(small.getByText('La foglia', { exact: true })).toBeVisible();
  await expect(small.getByRole('img', { name: '2 di 6' })).toBeVisible();
  await expect(small.getByText('2 di 6 passi', { exact: true })).toBeVisible();
  expect(await small.getByRole('button').count()).toBeLessThanOrEqual(1);
  await small.click();
  await expect(page).toHaveURL(/\/desk\/studio/);

  await placeStudy(pc, 'medium');
  await page.goto('/desk');
  const medium = panel(page);
  await expect(medium.getByText('Prossimo passo', { exact: true })).toBeVisible();
  await expect(medium.getByText('Svolgi gli esercizi da 1 a 11.', { exact: true })).toBeVisible();
  await expect(medium.getByRole('checkbox', { name: 'Svolgi gli esercizi da 1 a 11.' })).toBeVisible();
  await expect(medium.getByRole('button', { name: 'Apri il PDF' })).toBeVisible();
  await expect(medium.getByRole('link', { name: 'Apri Studio', exact: true })).toHaveAttribute('href', '/desk/studio');

  const firstSave = page.waitForResponse((res) => res.url().includes('/trpc/study.setStep') && res.ok());
  await medium.getByRole('checkbox', { name: 'Svolgi gli esercizi da 1 a 11.' }).click();
  await firstSave;
  await expect(medium.getByText('Confronta con le soluzioni.', { exact: true })).toBeVisible();
  const secondSave = page.waitForResponse((res) => res.url().includes('/trpc/study.setStep') && res.ok());
  await medium.getByRole('checkbox', { name: 'Confronta con le soluzioni.' }).click();
  await secondSave;
  await expect(medium.getByText('Rivedi gli errori della giornata.', { exact: true })).toBeVisible();
  await expect(medium.getByRole('button', { name: 'Apri il PDF' })).toHaveCount(0);
});

test('A2: ticking a step in Grande updates Studio page and count to 3 di 6', async ({ page, pc }) => {
  await seedStudy(pc, 2);
  await placeStudy(pc, 'large');
  await page.goto('/desk');
  const large = panel(page);
  await expect(large.getByText('G1 · Botanica · 2 di 6 passi')).toBeVisible();
  await expect(large.getByRole('checkbox', { name: 'Rileggi gli esempi come riscontro.' })).toBeChecked();
  const saved = page.waitForResponse((res) => res.url().includes('/trpc/study.setStep') && res.ok());
  await large.getByRole('checkbox', { name: 'Svolgi gli esercizi da 1 a 11.' }).click();
  await saved;
  await expect(large.getByText('G1 · Botanica · 3 di 6 passi')).toBeVisible();
  await expect(large.getByRole('img', { name: '3 di 6' })).toBeVisible();

  await large.getByRole('link', { name: 'Apri Studio', exact: true }).click();
  await expect(page).toHaveURL(/\/desk\/studio/);
  await expect(page.getByRole('checkbox', { name: 'Svolgi gli esercizi da 1 a 11.' })).toBeChecked();
  await expect(page.getByRole('paragraph').filter({ hasText: 'di 6 passi' })).toMatchAriaSnapshot(
    '- paragraph: 3 di 6 passi',
  );
  await expect(page.getByRole('img', { name: '3 di 6' })).toBeVisible();
});

test('A3: Avvia Pomodoro starts focus tagged with the current study day', async ({ page, pc }) => {
  await seedStudy(pc, 2);
  await placeStudy(pc, 'large');
  await page.goto('/desk');
  const large = panel(page);
  const startReq = page.waitForRequest((req) => req.url().includes('/trpc/pomodoro.startTagged'));
  const startRes = page.waitForResponse((res) => res.url().includes('/trpc/pomodoro.startTagged') && res.ok());
  await large.getByRole('button', { name: 'Avvia Pomodoro' }).click();
  const req = await startReq;
  await startRes;
  const payload: unknown = req.postDataJSON();
  const entry = typeof payload === 'object' && payload !== null && '0' in payload ? payload['0'] : payload;
  expect(entry).toEqual({ tag: 'study/example/A01' });
});

test('A4: no active plan shows Nessun piano attivo and no step rows in every size', async ({ page, pc }) => {
  const plans: Array<{ id: string }> = (await (await pc.get('/trpc/study.active')).json()).result.data;
  for (const { id } of plans) await setPlan(pc, id, false);
  for (const size of ['small', 'medium', 'large'] as const) {
    await placeStudy(pc, size);
    await page.goto('/desk');
    const card = panel(page);
    await expect(card.getByText('Nessun piano attivo', { exact: true })).toBeVisible();
    await expect(card.getByRole('link', { name: 'Apri Studio', exact: true })).toHaveAttribute('href', '/desk/studio');
    await expect(card.getByRole('checkbox')).toHaveCount(0);
    await expect(card.getByRole('listitem')).toHaveCount(0);
    if (size === 'small') expect(await card.getByRole('button').count()).toBeLessThanOrEqual(1);
  }
});

test('W1 & W3: every size fits at 4K and 1080p and Grande cuts to 6 rows with altri 2 passi', async ({ page, pc }) => {
  await seedStudy(pc, 2, { eightSteps: true });
  for (const size of ['small', 'medium', 'large'] as const) {
    await placeStudy(pc, size);
    for (const viewport of [
      { width: 3840, height: 2160 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/desk');
      const card = panel(page);
      await expect(card.getByText('La foglia', { exact: true })).toBeVisible();
      if (size === 'large') {
        await expect(card.getByRole('listitem')).toHaveCount(6);
        await expect(card.getByText('altri 2 passi', { exact: true })).toBeVisible();
      }
      const fits = await card.evaluate((el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth);
      expect(fits, `${size} at ${viewport.width}x${viewport.height}`).toBe(true);
    }
  }
});
