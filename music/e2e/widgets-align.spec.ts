import type { APIRequestContext, Page } from '../../../apps/e2e/tests/fixtures.ts';
import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';

const json = { 'content-type': 'application/json' };
const cell = (page: Page, id: string) => page.locator(`[data-widget="${id}"]`);
const panel = (page: Page, id: string) => cell(page, id).locator('section').first();
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

async function place(
  pc: APIRequestContext,
  items: Array<{ widget: string; size: 'small' | 'medium' | 'large'; x: number; y: number }>,
) {
  await pc.post('/trpc/layout.save', { data: { zone: 'overview', items }, headers: json });
}

async function expectFits(page: Page, id: string, label: string) {
  const card = panel(page, id);
  await expect
    .poll(() => card.evaluate((el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth), {
      message: label,
    })
    .toBe(true);
}

test.afterEach(async ({ pc }) => {
  await pc.post('/trpc/layout.reset', { data: { zone: 'overview' }, headers: json });
});

test('C2: Musica aligns Piccolo, Medio, and Grande with seek and Prossimi 3 at 4K and 1080p', async ({ page, pc }) => {
  const queueData = {
    current: null,
    seed: null,
    upcoming: [
      { id: 'u1', title: 'Brano Uno', artists: [{ name: 'Artista A' }], cover: null },
      { id: 'u2', title: 'Brano Due', artists: [{ name: 'Artista B' }], cover: null },
      { id: 'u3', title: 'Brano Tre', artists: [{ name: 'Artista C' }], cover: null },
      { id: 'u4', title: 'Brano Quattro', artists: [{ name: 'Artista D' }], cover: null },
    ],
    errors: 0,
  };
  await page.routeWebSocket(/\/trpc/, (socket) => {
    const server = socket.connectToServer();
    const queueIds = new Set<unknown>();
    socket.onMessage((message) => {
      try {
        const value: unknown = JSON.parse(message.toString());
        for (const item of Array.isArray(value) ? value : [value]) {
          if (isObject(item) && isObject(item.params) && item.params.path === 'music.onQueue') queueIds.add(item.id);
        }
      } catch {
        // Non-JSON frames are forwarded untouched.
      }
      server.send(message);
    });
    server.onMessage((message) => {
      try {
        const value: unknown = JSON.parse(message.toString());
        if (isObject(value) && queueIds.has(value.id) && isObject(value.result) && value.result.type === 'data') {
          socket.send(JSON.stringify({ ...value, result: { ...value.result, data: queueData } }));
          return;
        }
      } catch {
        // Non-JSON frames are forwarded untouched.
      }
      socket.send(message);
    });
  });

  await place(pc, [{ widget: 'media', size: 'small', x: 0, y: 0 }]);
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk');
  const small = panel(page, 'media');
  await expect(small.getByText('in riproduzione', { exact: true })).toBeVisible();
  await expect(small.getByText('Title', { exact: true })).toBeVisible();
  await expect(small.getByText('Artist', { exact: true })).toBeVisible();
  expect(await small.getByRole('button').count()).toBeLessThanOrEqual(1);
  await expectFits(page, 'media', 'media small 4K');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expectFits(page, 'media', 'media small 1080p');
  await small.getByRole('link', { name: 'Apri Media', exact: true }).click();
  await expect(page).toHaveURL(/\/desk\/media$/);

  await place(pc, [{ widget: 'media', size: 'medium', x: 0, y: 0 }]);
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk');
  const medium = panel(page, 'media');
  await expect(medium.getByRole('img', { name: 'Copertina di Title', exact: true })).toBeVisible();
  await expect(medium.getByRole('slider', { name: 'Posizione del brano' })).toBeVisible();
  await expect(medium.getByRole('button', { name: 'Brano precedente', exact: true })).toBeVisible();
  await expect(medium.getByRole('button', { name: 'Brano successivo', exact: true })).toBeVisible();
  await expect(medium.getByRole('link', { name: 'Apri Media', exact: true })).toHaveAttribute('href', '/desk/media');
  await expectFits(page, 'media', 'media medium 4K');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expectFits(page, 'media', 'media medium 1080p');

  await place(pc, [{ widget: 'media', size: 'large', x: 0, y: 0 }]);
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk');
  const large = panel(page, 'media');
  await expect(large.getByRole('slider', { name: 'Posizione del brano' })).toBeVisible();
  await expect(large.getByText('0:12', { exact: true }).last()).toBeVisible();
  await expect(large.getByText('3:33', { exact: true })).toBeVisible();
  await expect(large.getByText('Prossimi', { exact: true })).toBeVisible();
  await expect(large.getByRole('listitem')).toHaveCount(3);
  await expect(large.getByText('Brano Uno · Artista A')).toBeVisible();
  await expect(large.getByText('Brano Quattro')).toHaveCount(0);
  await expectFits(page, 'media', 'media large 4K');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expectFits(page, 'media', 'media large 1080p');
});
