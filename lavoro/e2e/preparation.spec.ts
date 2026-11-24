import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';

test('preparation expands and absent notes stay hidden', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk/ricerca?tab=candidature&job=fake-interview-key');
  const detail = page.getByRole('dialog', { name: 'Principal Engineer' });
  const preparation = detail.getByRole('region', { name: 'Preparazione' });
  await expect(preparation.getByText('Fase tecnica')).toBeVisible();
  await expect(preparation.getByText('Primo argomento')).toBeVisible();
  await expect(preparation.getByText('Risposta preparata')).toHaveCount(0);
  await preparation.getByRole('button', { name: 'Mostra tutto' }).click();
  await expect(preparation.getByText('Risposta preparata')).toBeVisible();
  await detail.getByRole('button', { name: 'Chiudi' }).click();
  await page.goto('/desk/ricerca?tab=candidature&job=fake-rejected-key');
  await expect(page.getByRole('dialog', { name: 'Staff Developer' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Preparazione' })).toHaveCount(0);
});

test('statistics shows the latest gaps note', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk/ricerca?tab=statistiche');
  const gaps = page.getByRole('region', { name: 'Lacune' });
  await expect(gaps.getByText('Competenza da studiare')).toBeVisible();
  await gaps.scrollIntoViewIfNeeded();
});
