import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';
test('a word list field shows its title and its caption like the other fields', async ({ page }) => {
  await page.goto('/desk/settings/study');
  // Regression (2026-11-13): the tag input had only an accessible name, no visible title, and its own smaller caption.
  await expect(page.getByText('Cartelle materiali', { exact: true })).toBeVisible();
  const size = (text: RegExp) => page.getByText(text).evaluate((node) => getComputedStyle(node).fontSize);
  expect(await size(/^Cartelle dei materiali di studio\./)).toBe(await size(/^Cartella dei piani;/));
});
