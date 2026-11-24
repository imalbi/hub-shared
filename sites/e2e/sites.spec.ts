import type { Page } from '../../../apps/e2e/tests/fixtures.ts';
import { answerQueries } from '../../../apps/e2e/tests/desktop.ts';
import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

test('Siti keeps its section in place while state arrives', async ({ page, request }) => {
  await configure(request, true);
  try {
    await page.setViewportSize({ width: 3840, height: 2160 });
    let release = () => {};
    let arrived = () => {};
    const stateArrived = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    await page.routeWebSocket(/\/trpc/, (socket) => {
      const server = socket.connectToServer();
      const ids = new Set<unknown>();
      const waiting: (string | Buffer)[] = [];
      let released = false;
      release = () => {
        released = true;
        for (const item of waiting) socket.send(item);
      };
      socket.onMessage((message) => {
        const value: unknown = JSON.parse(message.toString());
        for (const item of Array.isArray(value) ? value : [value])
          if (isObject(item) && isObject(item.params) && item.params.path === 'sites.onState') ids.add(item.id);
        server.send(message);
      });
      server.onMessage((message) => {
        const value: unknown = JSON.parse(message.toString());
        if (
          !released &&
          isObject(value) &&
          ids.has(value.id) &&
          isObject(value.result) &&
          value.result.type === 'data'
        ) {
          waiting.push(message);
          arrived();
        } else socket.send(message);
      });
    });
    await page.goto('/desk/lavoro');
    await stateArrived;
    const skeleton = page.getByRole('status', { name: 'Caricamento' });
    await expect(skeleton).toBeVisible();
    const before = await skeleton.boundingBox();
    release();
    const heading = page.getByRole('heading', { name: 'Alcuni siti non sono raggiungibili' });
    await expect(heading).toBeVisible();
    const after = await heading.boundingBox();
    if (!before || !after) throw new Error('Siti must be laid out');
    expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(8);
    expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(8);
    expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(8);
  } finally {
    await configure(request, false);
  }
});

test('an empty site list shows its empty state', async ({ page, request }) => {
  await configure(request, true);
  try {
    await page.routeWebSocket(/\/trpc/, (socket) => {
      const server = socket.connectToServer();
      const ids = new Set<unknown>();
      socket.onMessage((message) => {
        const value: unknown = JSON.parse(message.toString());
        for (const item of Array.isArray(value) ? value : [value])
          if (isObject(item) && isObject(item.params) && item.params.path === 'sites.onState') ids.add(item.id);
        server.send(message);
      });
      server.onMessage((message) => {
        const value: unknown = JSON.parse(message.toString());
        if (isObject(value) && ids.has(value.id) && isObject(value.result) && value.result.type === 'data') {
          socket.send(JSON.stringify({ ...value, result: { ...value.result, data: [] } }));
        } else socket.send(message);
      });
    });
    await page.goto('/desk/lavoro');
    await expect(page.getByRole('heading', { name: 'Nessun sito configurato.' })).toBeVisible();
  } finally {
    await configure(request, false);
  }
});

async function configure(request: import('../../../apps/e2e/tests/fixtures.ts').APIRequestContext, enabled: boolean) {
  const saved = await request.post('/trpc/settings.save', {
    data: {
      module: 'sites',
      enabled: true,
      value: enabled
        ? [
            { name: 'Sito pronto', url: 'https://example.com/up' },
            { name: 'Sito non raggiungibile', url: 'https://example.com/down' },
          ]
        : [],
    },
  });
  expect(saved.ok()).toBe(true);
  expect((await saved.json()).result.data.ok).toBe(true);
  await expect
    .poll(
      async () => {
        try {
          const response = await request.get('/trpc/sites.state');
          const data: unknown = await response.json();
          return JSON.stringify(data).includes('https://example.com/up');
        } catch {
          return null;
        }
      },
      { timeout: 15000 },
    )
    .toBe(enabled);
}

test('Siti shows daily history and the widget lists only unreachable sites', async ({ page, pc, request }) => {
  await configure(request, true);
  try {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await answerQueries(page, { health: { ok: true, uptime: 42 } });
    await page.goto('/desk/lavoro');
    await expect(page.getByRole('heading', { name: 'Alcuni siti non sono raggiungibili' })).toBeVisible();
    const history = page.getByRole('button', { name: 'Sito non raggiungibile' });
    await expect(history.locator('[data-bar]')).toHaveCount(90);
    await history.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('status').filter({ hasText: '5 minuti di interruzione' })).toBeVisible();
    await page.keyboard.press('Escape');
    await history.blur();
    await page.addStyleTag({ content: '[data-latency] { visibility: hidden; }' });
    await page.mouse.move(0, 0);
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await expect(page.getByRole('button', { name: 'Sito pronto', exact: true })).toBeVisible();
    await page.goto('/desk');
    await page.getByRole('button', { name: 'Modifica', exact: true }).click();
    await page.getByRole('button', { name: 'Aggiungi Siti', exact: true }).click();
    const widget = page.locator('[data-widget="sites"]');
    await expect(widget.getByText('Sito non raggiungibile')).toBeVisible();
    await expect(widget.getByText('Sito pronto')).toHaveCount(0);
    await page.goto('/desk/settings/sites');
    await expect(page.getByRole('heading', { name: 'Siti', level: 2 })).toBeVisible();
    await page.getByRole('textbox', { name: 'Nome riga 1' }).fill('Sito cambiato');
    await page.getByRole('button', { name: 'Salva e riavvia' }).click();
    await expect(page.getByText('Impostazioni salvate, Hub è di nuovo attivo')).toBeVisible({ timeout: 30000 });
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Nome riga 1' })).toHaveValue('Sito cambiato');
  } finally {
    await pc.post('/trpc/layout.reset', {
      data: { zone: 'overview' },
      headers: { 'content-type': 'application/json' },
    });
    await configure(request, false);
  }
});

async function delaySubscription(page: Page, path: string) {
  let release = () => {};
  await page.routeWebSocket(/\/trpc/, (socket) => {
    const server = socket.connectToServer();
    const ids = new Set<unknown>();
    const waiting: (string | Buffer)[] = [];
    let released = false;
    release = () => {
      released = true;
      for (const message of waiting) socket.send(message);
    };
    socket.onMessage((message) => {
      const value: unknown = JSON.parse(message.toString());
      for (const item of Array.isArray(value) ? value : [value])
        if (isObject(item) && isObject(item.params) && item.params.path === path) ids.add(item.id);
      server.send(message);
    });
    server.onMessage((message) => {
      const value: unknown = JSON.parse(message.toString());
      if (!released && isObject(value) && ids.has(value.id) && isObject(value.result) && value.result.type === 'data')
        waiting.push(message);
      else socket.send(message);
    });
  });
  return () => release();
}

function expectStableBox(
  before: { x: number; y: number; width: number; height: number } | null,
  after: { x: number; y: number; width: number; height: number } | null,
) {
  if (!before || !after) throw new Error('Content must be laid out');
  expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(8);
  expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(8);
  expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(8);
  expect(Math.abs(before.height - after.height)).toBeLessThanOrEqual(8);
}

function expectStablePosition(
  before: { x: number; y: number; width: number; height: number } | null,
  after: { x: number; y: number; width: number; height: number } | null,
) {
  if (!before || !after) throw new Error('Content must be laid out');
  expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(8);
  expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(8);
  expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(8);
}

test('Siti widget retains its box while state is delayed', async ({ page, pc, request }) => {
  await configure(request, true);
  try {
    await expect
      .poll(async () => (await (await request.get('/trpc/sites.state')).text()).includes('example.com/up'), {
        timeout: 15000,
      })
      .toBe(true);
    await pc.post('/trpc/layout.save', {
      data: { zone: 'overview', items: [{ widget: 'sites', size: 'small', x: 0, y: 0 }] },
    });
    await page.setViewportSize({ width: 3840, height: 2160 });
    const release = await delaySubscription(page, 'sites.onState');
    await page.goto('/desk');
    const widget = page.locator('[data-widget="sites"]');
    const skeleton = widget.getByRole('status', { name: 'Caricamento' });
    await expect(skeleton).toBeVisible();
    const before = await widget.boundingBox();
    release();
    await expect(widget.getByText('Sito non raggiungibile')).toBeVisible();
    expectStableBox(before, await widget.boundingBox());
  } finally {
    await pc.post('/trpc/layout.reset', { data: { zone: 'overview' } });
    await configure(request, false);
    await expect
      .poll(
        async () => {
          try {
            const response = await request.get('/trpc/sites.state');
            return !response.ok() || (await response.text()).includes('example.com/up');
          } catch {
            return true;
          }
        },
        { timeout: 15000 },
      )
      .toBe(false);
  }
});

test('work zone shows a skeleton while configured sites are delayed', async ({ page, request }) => {
  await configure(request, true);
  try {
    await expect
      .poll(async () => (await (await request.get('/trpc/sites.state')).text()).includes('example.com/up'), {
        timeout: 15000,
      })
      .toBe(true);
    await page.setViewportSize({ width: 3840, height: 2160 });
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/trpc/*sites.configured*', async (route) => {
      await pending;
      await route.continue();
    });
    await page.route('**/trpc/modules.enabled*', (route) => route.fulfill({ json: { result: { data: ['sites'] } } }));
    await page.goto('/desk/lavoro');
    const skeleton = page.getByRole('status', { name: 'Caricamento' }).first();
    await expect(skeleton).toBeVisible();
    const heading = page.locator('[data-page-surface] h2').first();
    const article = page.locator('[data-page-surface] article').first();
    const beforeHeading = await heading.boundingBox();
    const beforeArticle = await article.boundingBox();
    await page.screenshot({ path: '/tmp/hub88-work-zone-loading.png' });
    release();
    await expect(page.getByRole('heading', { name: 'Alcuni siti non sono raggiungibili' })).toBeVisible();
    expectStablePosition(beforeHeading, await heading.boundingBox());
    expectStablePosition(beforeArticle, await article.boundingBox());
  } finally {
    await configure(request, false);
    await expect
      .poll(
        async () => {
          try {
            const response = await request.get('/trpc/sites.state');
            return !response.ok() || (await response.text()).includes('example.com/up');
          } catch {
            return true;
          }
        },
        { timeout: 15000 },
      )
      .toBe(false);
  }
});
