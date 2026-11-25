import { expect, test, type Page } from '../../../apps/e2e/tests/fixtures.ts';

async function delayQuery(page: Page, path: string) {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/trpc/*', async (route) => {
    const paths = new URL(route.request().url()).pathname.replace('/trpc/', '').split(',');
    if (!paths.includes(path)) return route.fallback();
    await pending;
    await route.continue();
  });
  return release;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

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

test('Ascolta waits for the initial queue before showing an empty state', async ({ page }) => {
  const release = await delaySubscription(page, 'music.onQueue');
  try {
    await page.goto('/desk/media');
    const content = page.getByRole('region', { name: 'Prossimi', exact: true });
    const loading = content.getByRole('status', { name: 'Caricamento' });
    await expect(loading).toBeVisible();
    await expect(content.getByText('Nessuna radio attiva: fai partire un brano')).toHaveCount(0);
    release();
    await expect(loading).toHaveCount(0);
    await expect(content.getByText('Nessuna radio attiva: fai partire un brano')).toBeVisible();
  } finally {
    release();
    await page.close();
  }
});

for (const entry of [
  { name: 'Preferiti', query: 'music.favorites', empty: 'Nessun preferito' },
  { name: 'Cronologia', query: 'music.history', empty: 'Nessun brano ascoltato' },
  { name: 'Risultati', query: 'music.search', empty: 'Nessun risultato' },
]) {
  test(`${entry.name} waits for its active query`, async ({ page }) => {
    const release = await delayQuery(page, entry.query);
    try {
      await page.goto('/desk/media');
      if (entry.name === 'Risultati') await page.getByRole('searchbox', { name: 'Cerca musica' }).fill('canzone');
      else await page.getByRole('button', { name: entry.name, exact: true }).click();
      const content = page.getByRole('region', { name: entry.name, exact: true });
      const loading = content.getByRole('status', { name: 'Caricamento' });
      await expect(loading).toBeVisible();
      await expect(content.getByText(entry.empty, { exact: true })).toHaveCount(0);
      release();
      await expect(loading).toHaveCount(0);
      if (entry.name === 'Risultati')
        await expect(content.getByRole('button', { name: 'Riproduci Brano 1', exact: true })).toBeVisible();
      else await expect(content.getByText(entry.empty, { exact: true })).toBeVisible();
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
