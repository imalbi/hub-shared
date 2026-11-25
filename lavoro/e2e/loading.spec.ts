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

for (const tab of ['Annunci', 'Candidature', 'Statistiche', 'Regole']) {
  test(`${tab} waits for the initial postings before showing content`, async ({ page }) => {
    const release = await delayQuery(page, 'lavoro.list');
    try {
      await page.goto('/desk/ricerca?candidature=all');
      await page.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
      const content = page.getByRole('tabpanel');
      const loading = content.getByRole('status', { name: 'Caricamento...' });
      await expect(loading).toBeVisible();
      await expect(content.locator('[data-empty-variant]')).toHaveCount(0);
      release();
      await expect(loading).toHaveCount(0);
      await expect(content).toBeVisible();
      if (tab === 'Candidature') await expect(content.getByText('Principal Engineer', { exact: true })).toBeVisible();
      if (tab === 'Regole')
        await expect(content.getByRole('switch', { name: 'Disattiva regola Zeta Mobile' })).toBeVisible();
    } finally {
      release();
      await page.unrouteAll({ behavior: 'wait' });
    }
  });
}
