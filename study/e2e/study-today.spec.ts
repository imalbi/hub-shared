import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { APIRequestContext, Locator, Page } from '../../../apps/e2e/tests/fixtures.ts';
import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';
import { RUN_TMP } from '../../../apps/e2e/tests/hosts.ts';
import { legiblePlan } from './study-fixtures.ts';

async function openToday(page: Page, pc: APIRequestContext) {
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  db.prepare("DELETE FROM progress WHERE plan_id IN ('example', '*')").run();
  db.prepare("DELETE FROM preferences WHERE plan_id = '*'").run();
  db.close();
  const inbox = join(RUN_TMP, 'study', 'in-arrivo');
  await mkdir(inbox, { recursive: true });
  await writeFile(join(inbox, 'legible.json'), JSON.stringify(await legiblePlan()));
  expect((await pc.post('/trpc/study.activate', { data: { name: 'legible.json' } })).ok()).toBe(true);
  await page.goto('/desk/studio');
  await expect(page.getByRole('heading', { name: 'La foglia', level: 2 })).toBeVisible();
}

async function box(locator: Locator) {
  const found = await locator.boundingBox();
  if (!found) throw new Error('Element has no box');
  return found;
}
const intersects = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('plan and review show the empty state without an active plan', async ({ page }) => {
  const { answerQueries } = await import('../../../apps/e2e/tests/desktop.ts');
  await answerQueries(page, { 'study.active': [], 'study.index': null });
  await page.goto('/desk/studio?tab=piano');
  await expect(page.getByRole('heading', { name: 'Nessun piano attivo' })).toBeVisible();
  await page.getByRole('tab', { name: 'Ripasso', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nessun piano attivo' })).toBeVisible();
});

test('capture on Studio Oggi refers to the current study day', async ({ page, pc }) => {
  await openToday(page, pc);
  await page.keyboard.press('n');
  await expect(page.getByRole('dialog', { name: 'Nuovo post-it' }).getByText('Riguarda: G1 · La foglia')).toBeVisible();
});

test('Oggi lists the files to open, day materials first, each file once, and a pill opens its page', async ({
  page,
  pc,
}) => {
  await openToday(page, pc);
  const files = page.getByRole('group', { name: 'Da aprire' });
  await expect
    .poll(() => files.getByRole('button').evaluateAll((items) => items.map((item) => item.getAttribute('aria-label'))))
    .toEqual([
      'Dispensa',
      'Errata Verificati',
      'Capitolo 03 - La struttura delle foglie e dei tessuti',
      '2_Anatomia_vegetale_DV',
    ]);
  // The material's page wins over the step's page 3 for the same file.
  const popup = page.waitForEvent('popup');
  await files.getByRole('button', { name: 'Dispensa' }).click();
  const tab = await popup;
  const opened = await tab.waitForEvent('download');
  expect(opened.url()).toMatch(/#page=5$/);
  await tab.close();
});

test('Oggi stacks the blocks and shows a compact link per step instead of the path', async ({ page, pc }) => {
  await openToday(page, pc);
  const headings = await Promise.all(
    ['Mattino', 'Pomeriggio', 'Chiusura'].map((name) => box(page.getByRole('heading', { name, level: 4 }))),
  );
  for (const [i, heading] of headings.slice(1).entries()) {
    expect(heading.y).toBeGreaterThan((headings[i]?.y ?? 0) + 40);
    expect(Math.abs(heading.x - (headings[0]?.x ?? 0))).toBeLessThan(2);
  }
  const link = page.getByRole('button', { name: /^Apri p\. 34, Capitolo 03 - La struttura/ });
  await expect(link).toBeVisible();
  await expect(link).toContainText('Apri p. 34');
  await expect(page.getByRole('button', { name: /^Apri, 2_Anatomia_vegetale_DV\.pdf/ })).toContainText('Apri');
  await expect(page.getByRole('button', { name: /^Apri p\. 18, 2_Anatomia/ })).toContainText('Apri p. 18');
  await expect(page.getByText('Slide Ufficiali Prof')).toHaveCount(0);
  await expect(page.getByText(/Pagina \d+/)).toHaveCount(0);
  await expect(page.getByText('40 min', { exact: true })).toBeVisible();
});

test('Oggi header, counters and the next days read cleanly without phases', async ({ page, pc }) => {
  await openToday(page, pc);
  await expect(page.getByText(/Botanica.*G1/)).toBeVisible();
  const count = page.getByRole('paragraph').filter({ hasText: 'di 6 passi' });
  await expect(count).toMatchAriaSnapshot('- paragraph: 0 di 6 passi');
  await page.getByRole('checkbox', { name: 'Scrivi tre righe di sintesi.' }).check();
  await expect(count).toMatchAriaSnapshot('- paragraph: 1 di 6 passi');
  await expect(page.getByText(/di 3 G completate/)).toHaveCount(1);
});

test('the step error button shows a tooltip on hover and on focus', async ({ page, pc }) => {
  await openToday(page, pc);
  const buttons = page.getByRole('button', { name: /^Registra un errore su: / });
  await expect(buttons).toHaveCount(6);
  const first = buttons.first();
  await first.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Registra un errore');
  await page.mouse.move(0, 0);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  // Keyboard focus shows it too: the step without a file has the checkbox right before the button.
  await page.getByRole('checkbox', { name: 'Rivedi gli errori della giornata.' }).focus();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Registra un errore su: Rivedi gli errori della giornata.' }),
  ).toBeFocused();
  await expect(page.getByRole('tooltip')).toHaveText('Registra un errore');
});

test('no step error button covers text or another button', async ({ page, pc }) => {
  await openToday(page, pc);
  const buttons = page.getByRole('button', { name: /^Registra un errore su: / });
  await expect(buttons).toHaveCount(6);
  // No error button intersects any step text or another step's button (the glyph used to land on a neighbour's text).
  const texts = await Promise.all(
    [
      'Leggi il capitolo sui tessuti e annota i termini nuovi.',
      'Rileggi gli esempi come riscontro.',
      'Svolgi gli esercizi da 1 a 11.',
      'Confronta con le soluzioni.',
      'Rivedi gli errori della giornata.',
      'Scrivi tre righe di sintesi.',
    ].map((text) => box(page.getByText(text))),
  );
  const marks = await Promise.all((await buttons.all()).map((button) => box(button)));
  for (const mark of marks) for (const text of texts) expect(intersects(mark, text)).toBe(false);
  for (const [i, a] of marks.entries()) for (const b of marks.slice(i + 1)) expect(intersects(a, b)).toBe(false);
});

test('instrument columns, ticks, current step and timer follow the study day', async ({ page, pc }) => {
  await openToday(page, pc);
  const steps = page.locator('[data-study-day] li').filter({ has: page.getByRole('checkbox') });
  await expect(steps).toHaveCount(6);
  for (let index = 0; index < 6; index++)
    await expect(steps.nth(index)).toContainText(String(index + 1).padStart(2, '0'));
  for (const viewport of [
    { width: 3840, height: 2160 },
    { width: 1920, height: 1080 },
  ]) {
    await page.setViewportSize(viewport);
    const day = await box(page.locator('[data-study-day]'));
    const dial = await box(page.locator('[data-study-dial]'));
    const next = await box(page.locator('[data-study-next]'));
    expect(day.x).toBeLessThan(dial.x);
    expect(dial.x).toBeLessThan(next.x);
    expect(Math.abs(day.y - dial.y)).toBeLessThan(8);
    expect(Math.abs(day.y - next.y)).toBeLessThan(8);
  }
  await page.getByRole('checkbox', { name: 'Leggi il capitolo sui tessuti e annota i termini nuovi.' }).check();
  await page.getByRole('checkbox', { name: 'Rileggi gli esempi come riscontro.' }).check();
  const ticks = page.getByRole('img', { name: '2 di 6' });
  await expect(ticks.locator('i')).toHaveCount(6);
  await expect(ticks.locator('i[data-filled]')).toHaveCount(2);
  const current = page.locator('li[data-current]');
  await expect(current).toContainText('Svolgi gli esercizi da 1 a 11.');
  await expect(current.getByRole('button', { name: /^Registra un errore su: / })).toBeVisible();
  await current.getByRole('checkbox').check();
  await expect(page.getByRole('img', { name: '3 di 6' })).toBeVisible();
  await expect(page.locator('li[data-current]')).toContainText('Confronta con le soluzioni.');
  await page
    .locator('li[data-current]')
    .getByRole('button', { name: /^Registra un errore su: / })
    .click();
  await expect(page.getByRole('textbox', { name: /Riferimento/ })).toBeVisible();
  await expect(page.getByText('Leggi il capitolo sui tessuti e annota i termini nuovi.')).not.toHaveCSS(
    'font-family',
    /JetBrains Mono/,
  );
  await expect(page.getByText('Leggi il capitolo sui tessuti e annota i termini nuovi.')).toHaveCSS(
    'font-family',
    /Urbanist/,
  );
  await expect(page.getByRole('timer', { name: /tempo rimanente/i })).toHaveCSS('font-family', /JetBrains Mono/);
});

test('the instrument timer pauses the server and the subject selector saves its state', async ({ page, pc }) => {
  await openToday(page, pc);
  await expect(page.getByText(/Botanica.*G1 di 3/i)).toBeVisible();
  try {
    await page.getByRole('button', { name: 'Avvia Pomodoro' }).click();
    const paused = page.waitForResponse((response) => response.url().includes('pomodoro.pause') && response.ok());
    await page.getByRole('button', { name: 'Metti in pausa' }).click();
    await paused;
    const state = (await (await pc.get('/trpc/pomodoro.state')).json()).result.data;
    expect(state.pausedRemainingMs).toBeGreaterThan(0);
    const seconds = Math.ceil(state.pausedRemainingMs / 1000);
    await expect(page.getByRole('timer', { name: 'Tempo rimanente' })).toContainText(
      `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`,
    );
  } finally {
    await pc.post('/trpc/pomodoro.stop', { data: {} });
  }
  const subject = page.getByRole('button', { name: 'Materia: In corso' });
  await subject.click();
  const saved = page.waitForResponse((response) => response.url().includes('study.setSubject') && response.ok());
  await page.getByRole('option', { name: 'In pausa' }).click();
  await saved;
  await expect(page.getByRole('heading', { name: 'Nessun piano attivo' })).toBeVisible();
  await pc.post('/trpc/study.setSubject', { data: { plan: 'example', id: 'a', state: 'active' } });
});

test('day ruler places completed focus and advances the present mark', async ({ page }) => {
  const { answerQueries } = await import('../../../apps/e2e/tests/desktop.ts');
  const now = new Date();
  now.setHours(18, 40, 0, 0);
  const start = new Date(now);
  start.setHours(10, 0, 0, 0);
  const end = new Date(now);
  end.setHours(10, 25, 0, 0);
  await page.clock.install({ time: now });
  await answerQueries(page, {
    'pomodoro.today': [{ startedAt: start.getTime(), endedAt: end.getTime(), tag: 'test' }],
  });
  await page.goto('/desk/studio');
  const ruler = page.locator('[data-day-ruler]');
  const mark = page.locator('[data-day-now]');
  const area = await box(ruler);
  const block = await box(page.locator('[data-day-block]'));
  expect(Math.abs(block.x - area.x - (area.width * 4) / 18)).toBeLessThan(2);
  const before = await box(mark);
  expect(Math.abs(before.x - area.x - (area.width * (12 + 40 / 60)) / 18)).toBeLessThan(2);
  await page.clock.fastForward('01:00:00');
  const after = await box(mark);
  expect(Math.abs(after.x - before.x - area.width / 18)).toBeLessThan(2);
});

test('Studio scrolls only as far as its content: the timer digits do not stretch the page', async ({ page, pc }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await openToday(page, pc);
  await page.getByRole('button', { name: 'Avvia Pomodoro' }).click();
  try {
    await expect(page.getByRole('button', { name: 'Metti in pausa' })).toBeVisible();
    const { scroll, content } = await page.locator('[data-page-scroller]').evaluate((scroller) => {
      const panel = scroller.querySelector('[role="tabpanel"]') ?? scroller;
      const top = scroller.getBoundingClientRect().top - scroller.scrollTop;
      return { scroll: scroller.scrollHeight, content: panel.getBoundingClientRect().bottom - top };
    });
    // NumberRoll stacks every digit in a strip about 5000 px tall; the dial clips it (it once added 1600 px of scroll).
    expect(scroll - content).toBeLessThan(200);
  } finally {
    await pc.post('/trpc/pomodoro.stop', { data: {} });
  }
});
