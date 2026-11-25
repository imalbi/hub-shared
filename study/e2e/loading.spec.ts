import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';
import { RUN_TMP } from '../../../apps/e2e/tests/hosts.ts';
import { legiblePlan } from './study-fixtures.ts';

function expectStablePosition(
  before: { x: number; y: number; width: number; height: number } | null,
  after: { x: number; y: number; width: number; height: number } | null,
) {
  if (!before || !after) throw new Error('Content must be laid out');
  expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(8);
  expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(8);
  expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(8);
}

test.afterEach(() => {
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  try {
    db.prepare('DELETE FROM plans WHERE id = ?').run('loading-geometry');
    for (const table of ['days', 'progress', 'preferences'])
      db.prepare(`DELETE FROM ${table} WHERE plan_id = ?`).run('loading-geometry');
  } finally {
    db.close();
  }
});

const cases = [
  {
    name: 'Studio Oggi',
    url: '/desk/studio',
    query: 'study.index',
    label: 'Caricamento',
    selectors: ['[role="tablist"]', '[data-study-day]', '[data-study-day] h2', '[data-study-day] p'],
    first: '[data-study-day] > div',
  },
  {
    name: 'Studio Piano',
    url: '/desk/studio?tab=piano',
    query: 'study.index',
    label: 'Caricamento',
    selectors: ['[role="tablist"]', '[data-panel]', '[data-panel] > div:first-child', '[data-panel] fieldset button'],
    first: '[data-panel] > div:nth-child(3)',
  },
  {
    name: 'Studio Ripasso',
    url: '/desk/studio?tab=ripasso',
    query: 'study.review',
    label: 'Caricamento',
    selectors: ['[role="tablist"]', '[data-panel]', '[data-panel] > div:first-child', '[data-panel] fieldset'],
    first: '[data-panel] > :nth-child(3)',
  },
];

for (const entry of cases) {
  test(`${entry.name} holds its position while loading`, async ({ page, pc }) => {
    {
      const inbox = join(RUN_TMP, 'study', 'in-arrivo');
      await mkdir(inbox, { recursive: true });
      await writeFile(
        join(inbox, 'geometry.json'),
        JSON.stringify({ ...(await legiblePlan()), id: 'loading-geometry' }),
      );
      expect((await pc.post('/trpc/study.activate', { data: { name: 'geometry.json' } })).ok()).toBe(true);
    }
    await page.setViewportSize({ width: 3840, height: 2160 });
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/trpc/*', async (route) => {
      if (!decodeURIComponent(route.request().url()).includes(entry.query)) return route.fallback();
      await pending;
      await route.continue();
    });
    await page.goto(entry.url);
    const skeleton = page.getByRole('status', { name: entry.label }).first();
    await expect(skeleton).toBeVisible();
    const boxes = await Promise.all(entry.selectors.map((selector) => page.locator(selector).first().boundingBox()));
    const firstBlock = entry.first ? await skeleton.boundingBox() : null;
    release();
    await expect(skeleton).toHaveCount(0);
    for (const [index, selector] of entry.selectors.entries()) {
      const target = page.locator(selector).first();
      await expect(target).toBeVisible();
      expectStablePosition(boxes[index] ?? null, await target.boundingBox());
    }
    if (entry.first) expectStablePosition(firstBlock, await page.locator(entry.first).first().boundingBox());
  });
}

test('Studio day details hold their position while loading', async ({ page, pc }) => {
  const inbox = join(RUN_TMP, 'study', 'in-arrivo');
  await mkdir(inbox, { recursive: true });
  await writeFile(
    join(inbox, 'geometry-day.json'),
    JSON.stringify({ ...(await legiblePlan()), id: 'loading-geometry' }),
  );
  expect((await pc.post('/trpc/study.activate', { data: { name: 'geometry-day.json' } })).ok()).toBe(true);
  await page.setViewportSize({ width: 3840, height: 2160 });
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/trpc/*study.daysById*', async (route) => {
    await pending;
    await route.continue();
  });
  await page.goto('/desk/studio?tab=piano');
  const day = page.getByRole('button', { name: /^G1 ·/ }).first();
  await expect(day).toBeVisible();
  const skeleton = day.locator('..').getByRole('status', { name: 'Caricamento' });
  await expect(skeleton).toBeVisible();
  const before = await skeleton.locator('..').boundingBox();
  const parentId = await skeleton.locator('../..').getAttribute('id');
  if (!parentId) throw new Error('Day detail has no id');
  release();
  await expect(skeleton).toHaveCount(0);
  const loaded = page.locator(`[id="${parentId}"] > div`).first();
  await expect(loaded).toBeVisible();
  const after = await loaded.boundingBox();
  expectStablePosition(before, after);
});
