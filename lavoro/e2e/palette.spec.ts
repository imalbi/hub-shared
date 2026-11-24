// The private folder cannot resolve `@playwright/test`, so the page type comes through the shared fixtures.
import { expect, test, type Page } from '../../../apps/e2e/tests/fixtures.ts';

// Step 64, part C: the palette finds Lavoro postings and applications. The fake server is shared with lavoro.spec.ts,
// which leaves postings archived, deleted or applied, so this spec picks its two postings from the list at run time
// and restores what it changes.
const palette = (page: Page) => page.getByRole('dialog', { name: 'Comandi' });

async function openPalette(page: Page) {
  await page.goto('/desk');
  await page.getByRole('button', { name: 'Cerca o esegui, scorciatoia Ctrl K' }).click();
  await expect(palette(page).getByRole('combobox')).toBeFocused();
  await expect(palette(page).getByRole('option', { name: /Avvia Pomodoro/ })).toBeVisible();
}

const urlParams = (page: Page) => {
  const url = new URL(page.url());
  return { path: url.pathname, ...Object.fromEntries(url.searchParams) };
};

type Row = {
  key: string;
  title: string;
  company: string;
  application: unknown;
  deletedAt: number | null;
  archivedAt: number | null;
  blacklistRule: number | null;
};

test('the palette finds postings and applications, and a row opens the detail', async ({ page, pc }) => {
  expect((await pc.post('/trpc/lavoro.raccogli', { data: {} })).ok()).toBe(true);
  const jobs = async (): Promise<Row[]> => (await (await pc.get('/trpc/lavoro.list')).json()).result.data.jobs;
  await expect.poll(async () => (await jobs()).length, { timeout: 15000 }).toBeGreaterThanOrEqual(6);
  const inReview = (await jobs()).filter(
    (job) => !job.application && job.deletedAt === null && job.archivedAt === null && job.blacklistRule === null,
  );
  const [posting, applied] = [inReview[0], inReview.find((job) => job.title !== inReview[0]?.title)];
  if (!posting || !applied) throw new Error('Two postings in Da valutare are needed');
  expect((await pc.post('/trpc/lavoro.setApplication', { data: { key: applied.key } })).ok()).toBe(true);
  try {
    await openPalette(page);
    await palette(page).getByRole('combobox').fill(posting.title);
    const postings = palette(page).getByRole('group', { name: /Annunci/ });
    const row = postings.getByRole('option', { name: posting.title }).first();
    await expect(row).toContainText(posting.company);
    await expect(row).toContainText('Da valutare');
    await expect(postings).toContainText(/\d/);
    await row.click();
    await expect.poll(() => urlParams(page)).toEqual({ path: '/desk/ricerca', segment: 'review', job: posting.key });
    await expect(palette(page)).not.toBeVisible();
    await expect(page.locator('dialog[open]').getByRole('heading', { name: posting.title })).toBeVisible();

    await openPalette(page);
    await palette(page).getByRole('combobox').fill(applied.title);
    const applications = palette(page).getByRole('group', { name: /Candidature/ });
    const sent = applications.getByRole('option', { name: applied.title }).first();
    await expect(sent).toContainText(`${applied.company} · inviata oggi`);
    await expect(sent).toContainText('In attesa');
    await sent.click();
    await expect.poll(() => urlParams(page)).toEqual({ path: '/desk/ricerca', tab: 'candidature', job: applied.key });
    await expect(page.locator('dialog[open]').getByRole('heading', { name: applied.title })).toBeVisible();
  } finally {
    await pc.post('/trpc/lavoro.deleteApplication', { data: { key: applied.key, confirmed: true } });
  }
});
