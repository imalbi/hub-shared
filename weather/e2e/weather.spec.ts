import type { APIRequestContext, Page } from '../../../apps/e2e/tests/fixtures.ts';
import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';
const RESTARTED = { timeout: 30_000 };
const NOW = new Date('2026-11-19T10:00:00');
const json = { 'content-type': 'application/json' };
const today = (page: Page) => page.locator('[data-widget="today"]');

async function placeToday(pc: APIRequestContext, size: string) {
  await pc.post('/trpc/layout.save', {
    data: { zone: 'overview', items: [{ widget: 'today', size, x: 0, y: 0 }] },
    headers: json,
  });
}

async function open(page: Page) {
  await page.clock.setFixedTime(NOW);
  await page.goto('/desk');
  await expect(today(page)).toBeVisible();
}

test('weather with no data says so and links to its settings', async ({ page, pc }) => {
  await page.route('**/trpc/weather.state*', (route) =>
    route.fulfill({ json: [{ result: { data: { configured: false, current: null } } }] }),
  );
  for (const size of ['medium', 'wide']) {
    await placeToday(pc, size);
    await open(page);
    await expect(today(page).getByText(/Meteo non disponibile/)).toBeVisible();
    await expect(today(page).getByRole('link', { name: 'Imposta la città' })).toHaveAttribute(
      'href',
      '/desk/settings/weather',
    );
  }
});

test('weather with a location but no reading has no settings link', async ({ page, pc }) => {
  await page.route('**/trpc/weather.state*', (route) =>
    route.fulfill({ json: [{ result: { data: { configured: true, current: null } } }] }),
  );
  for (const size of ['medium', 'wide']) {
    await placeToday(pc, size);
    await open(page);
    await expect(today(page).getByText('Meteo non raggiungibile')).toBeVisible();
    await expect(today(page).getByRole('link', { name: 'Imposta la città' })).toHaveCount(0);
  }
});

test('weather location search shows empty and failed results and can retry', async ({ page }) => {
  let calls = 0;
  await page.route('**/trpc/weather.search*', async (route) => {
    calls++;
    if (calls === 2) await route.abort();
    else await route.fulfill({ json: [{ result: { data: [] } }] });
  });
  await page.goto('/desk/settings/weather');
  const search = page.getByLabel('Cerca località');
  const submit = page.getByRole('button', { name: 'Cerca', exact: true });
  await search.fill('Nessuno');
  await submit.click();
  await expect(page.getByText('Nessuna località trovata')).toBeVisible();
  await search.fill('Errore');
  await submit.click();
  await expect(page.getByRole('alert')).toHaveText('Ricerca non riuscita');
  await submit.click();
  await expect(page.getByText('Nessuna località trovata')).toBeVisible();
});

test('weather location search fills the settings draft', async ({ page }) => {
  await page.goto('/desk/settings/weather');
  await page.getByLabel('Cerca località').fill('Località');
  await page.getByRole('button', { name: 'Cerca', exact: true }).click();
  await page.getByRole('button', { name: 'Località esempio, Regione esempio' }).click();
  await expect(page.getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue('Località esempio');
  await expect(page.getByRole('group', { name: 'Latitudine' }).getByRole('status')).toHaveText(/^1\b/);
  await expect(page.getByRole('group', { name: 'Longitudine' }).getByRole('status')).toHaveText(/^2\b/);
  await page.getByRole('button', { name: 'Salva e riavvia' }).click();
  await expect(page.getByText('Impostazioni salvate, Hub è di nuovo attivo')).toBeVisible(RESTARTED);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Nome', exact: true })).toHaveValue('Località esempio');
  // With a place saved the row has nothing to say.
  await expect(page.getByRole('link', { name: /^Meteo/ })).not.toContainText('manca la città');
});

test('weather contribution fits every Oggi size and disappears when switched off', async ({ page, pc }) => {
  for (const size of ['medium', 'large', 'wide', 'full']) {
    await placeToday(pc, size);
    await open(page);
    await expect(today(page)).toContainText('19°');
    const panel = today(page).locator('[data-panel]').first();
    expect(
      await panel.evaluate(
        (element) => element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth,
      ),
      size,
    ).toBe(true);
  }
  await page.route('**/trpc/modules.enabled*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.result.data = body.result.data.filter((name: string) => name !== 'weather');
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await expect(today(page)).toBeVisible();
  await expect(today(page)).not.toContainText('19°');
  await expect(today(page).locator('[data-today-header]')).toHaveCount(0);
});
