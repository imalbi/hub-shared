import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { clean, seed } from './calendar-data.ts';
import { RUN_TMP } from '../../../apps/e2e/tests/hosts.ts';
import { legiblePlan } from './study-fixtures.ts';
import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';
import { answerQueries } from '../../../apps/e2e/tests/desktop.ts';

// Sunday 15 November 2026, 10:00: the month grid starts on Monday 26 October.
const NOW = new Date(2026, 10, 15, 10, 0);

test.beforeEach(async ({ page, pc }) => {
  await page.clock.install({ time: NOW });
  await seed(pc);
});
test.afterEach(async ({ pc }) => clean(pc));

test('day lines place calendar bands and keep nearby captions apart', async ({ page, pc }) => {
  await page.clock.setSystemTime(new Date(2026, 10, 15, 9, 0));
  await page.setViewportSize({ width: 3840, height: 2160 });
  await answerQueries(page, {
    'pomodoro.today': [
      {
        startedAt: new Date(2026, 10, 15, 8, 30).getTime(),
        endedAt: new Date(2026, 10, 15, 8, 55).getTime(),
        tag: null,
      },
    ],
  });
  await pc.post('/trpc/calendar.add', {
    data: { title: 'Turno prova', day: '2026-11-15', start: '10:00', end: '13:00' },
  });
  await pc.post('/trpc/calendar.add', { data: { title: 'Colloquio prova', day: '2026-11-15', start: '10:30' } });
  for (const path of ['/desk', '/desk/studio']) {
    await page.goto(path);
    const ruler = page.locator('[data-day-ruler]');
    const band = ruler.locator('[data-day-event][aria-label="Turno prova"]');
    const interview = ruler.locator('[data-day-event][aria-label="Colloquio prova"]');
    await expect(band).toBeVisible();
    await expect(interview).toBeVisible();
    const r = await ruler.boundingBox();
    const b = await band.boundingBox();
    const a = await ruler.locator('[data-day-caption]').getByText('10:00 Turno prova').boundingBox();
    const c = await ruler.locator('[data-day-caption]').getByText('10:30 Colloquio prova').boundingBox();
    const dentist = await ruler.locator('[data-day-caption]').getByText('16:30 Dentista').boundingBox();
    if (!r || !b || !a || !c || !dentist) throw new Error('missing day line box');
    expect(Math.abs((b.x - r.x) / r.width - 4 / 18)).toBeLessThan(0.005);
    expect(Math.abs(b.width / r.width - 3 / 18)).toBeLessThan(0.005);
    expect(a.x + a.width <= c.x || c.x + c.width <= a.x || a.y + a.height <= c.y || c.y + c.height <= a.y).toBe(true);
    expect(a.y).toBe(dentist.y);
    expect(c.y).toBeGreaterThan(a.y);
  }
  await pc.post('/trpc/calendar.add', {
    data: { title: 'Terzo appuntamento molto lungo', day: '2026-11-15', start: '10:31' },
  });
  await pc.post('/trpc/calendar.add', { data: { title: 'Fine giornata', day: '2026-11-15', start: '23:55' } });
  await page.goto('/desk');
  const captions = page.locator('[data-day-caption]');
  await expect(captions.getByText('10:31', { exact: true })).toBeVisible();
  const edge = await captions.getByText('23:55 Fine giornata').boundingBox();
  const ruler = await page.locator('[data-day-ruler]').boundingBox();
  if (!edge || !ruler) throw new Error('missing edge caption or ruler');
  expect(edge.x + edge.width).toBeLessThanOrEqual(ruler.x + ruler.width + 0.1);
  const boxes = await captions.evaluateAll((nodes) =>
    nodes.map((node) => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  expect(new Set(boxes.map((box) => box.y)).size).toBeLessThanOrEqual(2);
  for (const [index, a] of boxes.entries())
    for (const b of boxes.slice(index + 1))
      expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
});

test('Studio days slide from today, one a day, and open Studio', async ({ page, pc }) => {
  const inbox = join(RUN_TMP, 'study', 'in-arrivo');
  await mkdir(inbox, { recursive: true });
  await writeFile(join(inbox, 'calendar.json'), JSON.stringify(await legiblePlan()));
  expect((await pc.post('/trpc/study.activate', { data: { name: 'calendar.json' } })).ok()).toBe(true);
  await page.goto('/desk/calendar');
  const month = page.getByRole('region', { name: 'novembre 2026' });
  // The current day (La foglia) is today; the next open day is tomorrow, not today.
  await expect(month.locator('[data-day="2026-11-15"]').getByRole('button', { name: /La foglia/ })).toBeVisible();
  await expect(month.locator('[data-day="2026-11-14"]').getByRole('button')).toHaveCount(1);
  await expect(month.locator('[data-day="2026-11-16"]').getByRole('button')).toHaveCount(2);
  await expect(
    page.getByRole('complementary', { name: 'domenica 15 novembre' }).getByText('Studio', { exact: true }),
  ).toBeVisible();
  await month
    .locator('[data-day="2026-11-15"]')
    .getByRole('button', { name: /La foglia/ })
    .click();
  await expect(page).toHaveURL(/\/desk\/studio$/);
});
