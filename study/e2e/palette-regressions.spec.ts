import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';

test('a slow answer for an older query never replaces the newer one', async ({ page }) => {
  const queryOf = (url: string) => {
    const input: unknown = JSON.parse(new URL(url).searchParams.get('input') ?? '{}');
    return typeof input === 'object' && input !== null && '0' in input ? JSON.stringify(input['0']) : '';
  };
  const day = (key: string, title: string) => ({
    total: 1,
    rows: [{ key, g: 1, title, subject: 'p:a', done: false }],
    headers: [{ id: 'p', title: 'Corso', subjects: [{ id: 'a', name: 'Chimica' }] }],
  });
  await page.route('**/trpc/study.searchRecords*', async (route) => {
    const slow = queryOf(route.request().url()) === '{"query":"re"}';
    if (slow) await new Promise((resolve) => setTimeout(resolve, 1000));
    await route
      .fulfill({
        json: [{ result: { data: slow ? day('p/D1', 'Risposta vecchia') : day('p/D2', 'Risposta nuova') } }],
      })
      // The browser aborted the held request when the query changed.
      .catch(() => undefined);
  });
  await page.goto('/desk');
  await page.getByRole('button', { name: 'Cerca o esegui, scorciatoia Ctrl K' }).click();
  const palette = page.getByRole('dialog', { name: 'Comandi' });
  const field = palette.getByRole('combobox');
  await expect(palette.getByRole('option', { name: /Avvia Pomodoro/ })).toBeVisible();
  await field.fill('re');
  const asked = page.waitForRequest((request) => request.url().includes('study.searchRecords'));
  await asked;
  await field.fill('rea');
  await expect(palette.getByRole('option', { name: /Risposta nuova/ })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(palette.getByRole('option', { name: /Risposta nuova/ })).toBeVisible();
  await expect(palette.getByRole('option', { name: /Risposta vecchia/ })).toHaveCount(0);
});
