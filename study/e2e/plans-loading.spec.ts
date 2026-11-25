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

for (const query of ['study.active', 'study.index']) {
  test(`Studio Piani waits for ${query} before showing an empty state`, async ({ page }) => {
    const release = await delayQuery(page, query);
    try {
      await page.goto('/desk/studio?tab=piani');
      const loading = page.getByRole('status', { name: 'Caricamento' });
      await expect(loading).toBeVisible();
      await expect(page.getByText('Nessun piano attivo', { exact: true })).toHaveCount(0);
      release();
      await expect(loading).toHaveCount(0);
      await expect(page.getByText('Nessun piano attivo', { exact: true })).toBeVisible();
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
