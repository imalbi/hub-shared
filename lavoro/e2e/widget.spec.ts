import { rmSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '../../../apps/e2e/tests/fixtures.ts';
import { answerQueries } from '../../../apps/e2e/tests/desktop.ts';
import { holdFile } from './hold.ts';

const cell = (page: Page, widget: string) => page.locator(`[data-widget="${widget}"]`);

async function andSaved(page: Page, action: () => Promise<void>) {
  const response = page.waitForResponse((res) => res.url().includes('/trpc/layout.save') && res.ok());
  await action();
  await response;
}

async function expectNoOverflow(widget: ReturnType<typeof cell>) {
  const fit = await widget.evaluate((el) => ({
    vertical: el.scrollHeight <= el.clientHeight,
    horizontal: el.scrollWidth <= el.clientWidth,
  }));
  expect(fit).toEqual({ vertical: true, horizontal: true });
  await expect(widget.locator('.overflow-y-auto')).toHaveCount(0);
}

const summaryFixture = {
  review: 16,
  reviewToday: 3,
  byPossibility: { alta: 2, media: 3, bassa: 1, fuori: 0 },
  pending: 4,
  interviewing: 1,
  interviewsThisWeek: 1,
  lastCollectionAt: new Date(2026, 10, 20, 12, 48).getTime(),
  top: [
    {
      key: 'job-alta-1',
      title: 'Full Stack Developer, Front End Oriented',
      company: 'Bit Spa',
      location: 'Torino',
      score: 24,
      possibility: 'alta' as const,
      codes: [],
      outdated: false,
    },
    {
      key: 'job-alta-2',
      title: 'Frontend Developer React',
      company: 'Vibe Srl',
      location: 'Remoto',
      score: 19,
      possibility: 'alta' as const,
      codes: [],
      outdated: false,
    },
    {
      key: 'job-media-1',
      title: 'Web Developer Junior',
      company: 'Teoresi',
      location: 'Torino',
      score: 27,
      possibility: 'media' as const,
      codes: ['salary'],
      outdated: false,
    },
    {
      key: 'job-media-2',
      title: 'Software Developer',
      company: 'Ecomec',
      location: 'Moncalieri',
      score: 18,
      possibility: 'media' as const,
      codes: ['work_mode'],
      outdated: false,
    },
  ],
};

test.afterEach(async ({ pc }) => {
  rmSync(holdFile, { force: true });
  await pc.post('/trpc/layout.reset', {
    data: { zone: 'overview' },
    headers: { 'content-type': 'application/json' },
  });
});

test('W1: Lavoro stays off the default board and persists after adding and resizing across all sizes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk');
  await expect(cell(page, 'pomodoro')).toBeVisible();
  await expect(cell(page, 'lavoro')).toHaveCount(0);

  await page.getByRole('button', { name: 'Modifica', exact: true }).click();
  await page.getByRole('button', { name: 'Aggiungi widget', exact: true }).click();
  await andSaved(page, () => page.getByRole('button', { name: 'Aggiungi Lavoro' }).click());

  const widget = cell(page, 'lavoro');
  await expect(widget).toHaveAttribute('data-size', 'small');

  for (const [label, expected] of [
    ['Medio', 'medium'],
    ['Grande', 'large'],
  ] as const) {
    await andSaved(page, () =>
      page
        .getByRole('group', { name: 'Dimensione di Lavoro' })
        .locator('label', { has: page.getByRole('radio', { name: label }) })
        .click(),
    );
    await expect(widget).toHaveAttribute('data-size', expected);
  }

  await page.getByRole('button', { name: 'Fine', exact: true }).click();
  await page.reload();
  await expect(cell(page, 'lavoro')).toHaveAttribute('data-size', 'large');
});

test('D1 W1 W2: Lavoro renders Piccolo, Medio, and Grande at 4K and 1080p without overflow', async ({ page, pc }) => {
  await page.clock.setFixedTime(new Date(2026, 10, 20, 14, 0));
  await answerQueries(page, { 'lavoro.summary': summaryFixture });

  // Piccolo
  await pc.post('/trpc/layout.save', {
    data: { zone: 'overview', items: [{ widget: 'lavoro', size: 'small', x: 0, y: 0 }] },
  });
  for (const viewport of [
    { width: 3840, height: 2160 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/desk');
    const widget = cell(page, 'lavoro');
    await expect(widget).toHaveAttribute('data-size', 'small');
    await expect(widget.getByRole('heading', { name: 'Lavoro' })).toHaveCSS('font-family', /Urbanist/);
    await expect(widget.getByRole('heading', { name: 'Lavoro' })).toHaveCSS('text-transform', 'uppercase');
    await expect(widget.getByText('raccolta oggi 12:48', { exact: true })).toBeVisible();
    await expect(widget.locator('[data-readout] .sr-only')).toHaveText('16');
    await expect(widget.locator('[data-readout]')).toHaveCSS('font-family', /JetBrains Mono/);
    await expect(widget.locator('[data-readout]')).toHaveCSS('font-variant-numeric', /tabular-nums/);
    await expect(widget.getByText('da valutare', { exact: true })).toBeVisible();
    await expect(widget.getByText('2 con possibilità alta', { exact: true })).toBeVisible();
    await expect(widget.getByText('4 in attesa', { exact: true })).toBeVisible();
    expect(await widget.getByRole('button').count()).toBeLessThanOrEqual(1);
    await expectNoOverflow(widget);
  }
  await cell(page, 'lavoro').getByRole('link', { name: 'Apri Lavoro' }).click();
  await expect(page).toHaveURL(/\/desk\/ricerca$/);

  // Medio
  await pc.post('/trpc/layout.save', {
    data: { zone: 'overview', items: [{ widget: 'lavoro', size: 'medium', x: 0, y: 0 }] },
  });
  for (const viewport of [
    { width: 3840, height: 2160 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/desk');
    const widget = cell(page, 'lavoro');
    await expect(widget).toHaveAttribute('data-size', 'medium');
    await expect(widget.getByText('da valutare · raccolta 12:48', { exact: true })).toBeVisible();
    await expect(widget.getByText('4 candidature in attesa', { exact: true })).toBeVisible();
    await expect(widget.getByRole('button', { name: 'Raccogli' })).toBeVisible();
    const mediumLinks = widget.locator('ul a');
    await expect(mediumLinks).toHaveCount(2);
    await expect(mediumLinks.nth(0)).toContainText('Full Stack Developer, Front End Oriented');
    await expect(mediumLinks.nth(0)).toContainText('Bit Spa · Torino');
    await expect(mediumLinks.nth(0).getByRole('img', { name: 'Interesse 24' })).toBeVisible();
    await expect(mediumLinks.nth(1)).toContainText('Frontend Developer React');
    await expect(mediumLinks.nth(1).getByRole('img', { name: /Parere: Possibilità alta/ })).toBeVisible();
    await expectNoOverflow(widget);
  }
  await cell(page, 'lavoro').locator('ul a').nth(0).click();
  await expect(page).toHaveURL(/\/desk\/ricerca\?job=job-alta-1$/);

  // Grande
  await pc.post('/trpc/layout.save', {
    data: { zone: 'overview', items: [{ widget: 'lavoro', size: 'large', x: 0, y: 0 }] },
  });
  for (const viewport of [
    { width: 3840, height: 2160 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/desk');
    const widget = cell(page, 'lavoro');
    await expect(widget).toHaveAttribute('data-size', 'large');
    await expect(widget.getByText('16 da valutare · raccolta oggi 12:48', { exact: true })).toBeVisible();
    const groupHeadings = widget.getByRole('heading', { level: 3 });
    await expect(groupHeadings).toHaveCount(2);
    await expect(groupHeadings.nth(0)).toHaveText('Possibilità alta · 2');
    await expect(groupHeadings.nth(1)).toHaveText('Possibilità media · 3');
    const largeLinks = widget.locator('ul a');
    await expect(largeLinks).toHaveCount(4);
    await expect(largeLinks.nth(0)).toContainText('Full Stack Developer, Front End Oriented');
    await expect(largeLinks.nth(1)).toContainText('Frontend Developer React');
    await expect(largeLinks.nth(2)).toContainText('Web Developer Junior');
    await expect(largeLinks.nth(3)).toContainText('Software Developer');
    await expect(widget.getByText('4 in attesa · 1 in colloquio', { exact: true })).toBeVisible();
    await expect(widget.getByRole('button', { name: 'Raccogli' })).toBeVisible();
    await expect(widget.getByRole('link', { name: 'Apri Lavoro' })).toHaveAttribute('href', '/desk/ricerca');
    await expectNoOverflow(widget);
  }
});

test('D2: Grande Raccogli starts a live collection shown in the activity ball and Today updates without list polling', async ({
  page,
  pc,
}) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await pc.post('/trpc/layout.save', {
    data: {
      zone: 'overview',
      items: [
        { widget: 'today', size: 'wide', x: 0, y: 0 },
        { widget: 'lavoro', size: 'large', x: 0, y: 1 },
      ],
    },
  });

  let listQueries = 0;
  let summaryQueries = 0;
  page.on('request', (request) => {
    const pathname = decodeURIComponent(new URL(request.url()).pathname);
    if (!pathname.startsWith('/trpc/')) return;
    const procedures = pathname.replace('/trpc/', '').split(',');
    if (procedures.includes('lavoro.list')) listQueries += 1;
    if (procedures.includes('lavoro.summary')) summaryQueries += 1;
  });

  await page.goto('/desk');
  const widget = cell(page, 'lavoro');
  const today = cell(page, 'today');
  await expect(widget.getByRole('button', { name: 'Raccogli' })).toBeVisible();
  await expect(today).toBeVisible();
  // Oggi and Lavoro can mount their summary observers in separate startup batches.
  await page.waitForLoadState('networkidle');

  const settledSummaryCount = summaryQueries;
  await page.waitForTimeout(1500);
  expect(summaryQueries).toBe(settledSummaryCount);
  expect(listQueries).toBe(0);

  writeFileSync(holdFile, '');
  try {
    await widget.getByRole('button', { name: 'Raccogli' }).click();
    await expect(widget.getByText(/raccolta in corso/)).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /^Attività in corso: .*Raccogli annunci/ })).toBeVisible({
      timeout: 5000,
    });
  } finally {
    rmSync(holdFile, { force: true });
  }

  await expect(widget.getByText(/raccolta in corso/)).toHaveCount(0, { timeout: 10000 });
  await expect.poll(() => summaryQueries).toBeGreaterThan(settledSummaryCount);
  await expect(widget.getByText(/\d+ da valutare · raccolta /)).toBeVisible();
  expect(listQueries).toBe(0);
});
