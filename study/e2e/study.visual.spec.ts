import { answerQueries } from '../../../apps/e2e/tests/desktop.ts';
import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';
import { PC_URL, RUN_TMP } from '../../../apps/e2e/tests/hosts.ts';
import { freezePomodoro } from '../../../apps/e2e/tests/pomodoro-visual.ts';
import { legibleDay } from './study-fixtures.ts';
import { chooseTheme } from '../../../apps/e2e/tests/themes.ts';

test.beforeAll(async ({ request }) => {
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  db.prepare("DELETE FROM progress WHERE plan_id IN ('example', '*')").run();
  db.prepare("DELETE FROM preferences WHERE plan_id = '*'").run();
  db.close();
  const inbox = join(RUN_TMP, 'study', 'in-arrivo');
  await mkdir(inbox, { recursive: true });
  await copyFile(new URL('../fixtures/example.json', import.meta.url), join(inbox, 'visual.json'));
  expect((await request.post(`${PC_URL}/trpc/study.activate`, { data: { name: 'visual.json' } })).ok()).toBe(true);
});

test('Sistema and a scrolling Piano align their rightmost panel edges', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 2160 });
  await page.goto('/desk/system');
  const system = page.getByRole('region', { name: 'Audio', exact: true });
  await expect(system).toBeVisible();
  expect(
    await page.locator('[data-page-scroller]').evaluate((element) => element.scrollHeight <= element.clientHeight),
  ).toBe(true);
  const right = (await system.boundingBox())!.x + (await system.boundingBox())!.width;
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  const row = db.prepare("SELECT data FROM days WHERE plan_id = 'example' AND id = 'A01'").get();
  if (typeof row?.data !== 'string') throw new Error('The example plan is not active');
  const day = JSON.parse(row.data);
  const insert = db.prepare("INSERT INTO days (plan_id, id, position, data) VALUES ('example', ?, ?, ?)");
  for (let i = 0; i < 210; i++) {
    const id = `extra-${i}`;
    insert.run(id, i + 3, JSON.stringify({ ...day, id }));
  }
  try {
    await page.goto('/desk/studio?tab=piano');
    const piano = page.getByRole('region', { name: /Piano · Piano di esempio/ });
    await expect(piano).toBeVisible();
    const surface = page.locator('[data-page-scroller]');
    expect(await surface.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    const panel = page.getByRole('tabpanel');
    await surface.evaluate((element) => element.scrollTo(0, 400));
    expect(await surface.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect(await panel.evaluate((element) => element.scrollTop)).toBe(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight === document.documentElement.clientHeight),
    ).toBe(true);
    const box = (await piano.boundingBox())!;
    expect(Math.abs(box.x + box.width - right)).toBeLessThanOrEqual(1);
  } finally {
    db.prepare("DELETE FROM days WHERE plan_id = 'example' AND id LIKE 'extra-%'").run();
    db.close();
  }
});

/** Gives Ripasso something to list without touching the other Studio baselines: undone by the returned function. */
function seedReview() {
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  const row = db.prepare("SELECT data FROM days WHERE plan_id = 'example' AND id = 'A01'").get();
  if (typeof row?.data !== 'string') throw new Error('The example plan is not active');
  const original = row.data;
  const day = JSON.parse(original);
  day.blocks[0].steps.push({ id: 'A01.m.2', text: 'Disegna una foglia.' });
  db.prepare("UPDATE days SET data = ? WHERE plan_id = 'example' AND id = 'A01'").run(JSON.stringify(day));
  const insert = db.prepare("INSERT INTO progress (plan_id, kind, id, value) VALUES ('example', ?, ?, ?)");
  insert.run('step', 'A01.m.1', 'done');
  insert.run('autonomy', 'plants', 'red');
  insert.run('autonomy', 'stars', 'yellow');
  insert.run(
    'error',
    'seed-error',
    JSON.stringify({
      day: 'A01',
      reference: 'Foglio 1, es. 3',
      tried: 'Ho diviso per due',
      cause: 'calculation',
      method: 'Converti prima le unita',
      retry: 'example/B01',
      result: null,
    }),
  );
  return () => {
    db.prepare("UPDATE days SET data = ? WHERE plan_id = 'example' AND id = 'A01'").run(original);
    db.prepare("DELETE FROM progress WHERE plan_id = 'example'").run();
    db.close();
  };
}

/** Oggi with the shape of a real plan (no phases, long nested paths, day materials): undone by the returned function. */
function seedLong() {
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  const dayRow = db.prepare("SELECT data FROM days WHERE plan_id = 'example' AND id = 'A01'").get();
  const planRow = db.prepare("SELECT header FROM plans WHERE id = 'example'").get();
  if (typeof dayRow?.data !== 'string' || typeof planRow?.header !== 'string')
    throw new Error('The example plan is not active');
  const header = JSON.parse(planRow.header);
  db.prepare("UPDATE plans SET header = ? WHERE id = 'example'").run(JSON.stringify({ ...header, phases: [] }));
  db.prepare("UPDATE days SET data = ? WHERE plan_id = 'example' AND id = 'A01'").run(JSON.stringify(legibleDay));
  return () => {
    db.prepare("UPDATE plans SET header = ? WHERE id = 'example'").run(planRow.header);
    db.prepare("UPDATE days SET data = ? WHERE plan_id = 'example' AND id = 'A01'").run(dayRow.data);
    db.close();
  };
}

for (const theme of [
  { name: 'Scuro', id: 'ink' },
  { name: 'Chiaro', id: 'paper' },
]) {
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 3840, height: 2160 },
  ]) {
    for (const tab of [
      { name: 'Oggi', id: 'studio' },
      { name: 'Piano', id: 'piano' },
      { name: 'Materie', id: 'piani' },
      { name: 'Libreria', id: 'libreria' },
      { name: 'Ripasso', id: 'ripasso' },
      { name: 'Backlog', id: 'backlog' },
      { name: 'Oggi lungo', id: 'studio', long: true },
    ]) {
      test(`${tab.name} ${size.width} ${theme.id}`, async ({ page }) => {
        const restore = tab.id === 'ripasso' ? seedReview() : tab.long ? seedLong() : undefined;
        try {
          await page.setViewportSize(size);
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await freezePomodoro(page);
          await page.clock.setFixedTime(new Date('2026-11-04T12:00:00Z'));
          await answerQueries(page, {
            health: { ok: true, uptime: 42 },
            'pomodoro.today': [],
            'study.backlog': [
              {
                position: 1,
                id: 'visual-course',
                title: 'Corso di esempio',
                note: 'Un argomento alla volta, quando ho tempo.',
                url: 'https://example.com/course',
                status: 'todo',
              },
              { position: 2, id: 'visual-active', title: 'Riprendere le basi', note: '', url: '', status: 'active' },
              {
                position: 3,
                id: 'visual-completed',
                title: 'Introduzione completata',
                note: '',
                url: '',
                status: 'completed',
              },
            ],
          });
          await page.goto('/desk/settings/appearance');
          await chooseTheme(page, theme.name);
          await page.goto(`/desk/studio?tab=${tab.id}`);
          if (tab.id === 'studio') {
            await expect(page.getByRole('heading', { name: 'La foglia' })).toBeVisible();
            await expect(page.getByText('Sessioni completate oggi: 0')).toBeVisible();
          } else if (tab.id === 'ripasso') await expect(page.getByText('Foglio 1, es. 3')).toBeVisible();
          else if (tab.id === 'backlog')
            await expect(page.getByRole('heading', { name: 'Corso di esempio' })).toBeVisible();
          else if (tab.id === 'libreria') await expect(page.getByText('dispensa.pdf', { exact: false })).toBeVisible();
          else await expect(page.getByText('Piano di esempio').first()).toBeVisible();
          await page.evaluate(async () => {
            await document.fonts.ready;
          });
          await page.mouse.move(0, 0);
          await expect(page).toHaveScreenshot(
            `study-${tab.long ? 'oggi-long' : tab.id}-${size.width}-${theme.id}.png`,
            {
              animations: 'disabled',
            },
          );
          await page.goto('/desk/settings/appearance');
          await chooseTheme(page, 'Scuro');
        } finally {
          restore?.();
        }
      });
    }
  }
}
