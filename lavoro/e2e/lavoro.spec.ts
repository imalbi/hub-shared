import { rmSync, writeFileSync } from 'node:fs';
import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';
import { SERVER_URL } from '../../../apps/e2e/tests/hosts.ts';
import { holdFile } from './hold.ts';
import { buildServer } from '../../../apps/server/src/server.ts';
import { emptyConfig } from '../../../apps/server/src/core/config.ts';
import { z } from '../../../apps/server/src/core/module.ts';
import { createFakeDesktop } from '../../../apps/server/src/testing/fake-desktop.ts';
import { inventedProfile } from '../invented-profile.ts';
import { postingId } from '../server.ts';

test.afterEach(async ({ pc }) => {
  const input = encodeURIComponent(JSON.stringify({ key: 'fake-interview-key' }));
  const result = await (await pc.get(`/trpc/lavoro.addresses.list?input=${input}`)).json();
  for (const row of result.result.data)
    if (row.origin === 'thread')
      await pc.post('/trpc/lavoro.addresses.remove', { data: { key: 'fake-interview-key', address: row.address } });
});

for (const kind of ['raccogli', 'prova']) {
  test(`tracked collection ${kind} has one rich activity and streams into Jobs until cancelled`, async ({
    page,
    pc,
  }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await pc.post(`${SERVER_URL}/__fake/player`, { data: { gone: true } });
    writeFileSync(holdFile, '');
    try {
      await page.goto('/desk/ricerca');
      if (kind === 'prova') {
        await pc.post('/trpc/lavoro.prova', { data: {} });
      } else {
        await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
      }
      const label = kind === 'prova' ? 'Prova di raccolta' : 'Raccogli annunci';
      const jobLabel = kind === 'prova' ? 'Prova raccolta' : 'Raccogli offerte';
      const ball = page.getByRole('button', { name: `Attività in corso: ${label}`, exact: true });
      await expect(ball).toBeVisible();
      await ball.click();
      await expect(page.getByRole('button', { name: `Apri ${label}`, exact: true })).toHaveCount(1);
      await expect(page.getByRole('button', { name: /Apri.*job/ })).toHaveCount(0);
      await page.getByRole('button', { name: `Apri ${label}`, exact: true }).click();
      await expect(page).toHaveURL(/\/desk\/system\?tab=jobs$/);
      await expect(page.getByRole('button', { name: `${jobLabel} In esecuzione` })).toBeVisible();
      await expect(page.getByText(`lavoro.${kind}`, { exact: true })).toHaveCount(0);
      await expect(page.getByText(/0\/\d+ ricerche/).first()).toBeVisible();
      await expect(ball).toBeVisible();
      await holdButton(page, page.getByRole('button', { name: 'Tieni premuto per annullare job' }));
      await expect(page.getByRole('button', { name: `${jobLabel} Annullato` }).first()).toBeVisible();
      await expect(ball).toHaveCount(0);
    } finally {
      rmSync(holdFile, { force: true });
      await pc.post(`${SERVER_URL}/__fake/player`, { data: { gone: false } });
    }
  });
}

test('empty rules and an empty trial show their empty states', async ({ page }) => {
  await page.route('**/trpc/*', async (route) => {
    if (!route.request().url().includes('lavoro.list') && !route.request().url().includes('lavoro.state'))
      return route.fallback();
    const response = await route.fetch();
    const body = await response.json();
    for (const reply of Array.isArray(body) ? body : [body]) {
      if (reply.result?.data?.rules) reply.result.data.rules = [];
      if (reply.result?.data?.status === 'ready') reply.result.data.dryRun = [];
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto('/desk/ricerca');
  await page.getByRole('tab', { name: /Regole/ }).click();
  await expect(page.getByRole('heading', { name: 'Nessuna regola definita' })).toBeVisible();
  await page.getByRole('tab', { name: /Annunci/ }).click();
  await page.getByRole('button', { name: 'Altre azioni' }).click();
  await page.getByRole('menuitem', { name: 'Vedi prova' }).click();
  await expect(page.getByRole('heading', { name: 'Nessuna nuova offerta trovata durante la prova.' })).toBeVisible();
});

test('switching postings morphs the header and crossfades the description', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk/ricerca?sort=score');
  await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
  await page.getByText('Addetto sportello').first().click();
  const dialog = page.locator('dialog[open]').first();
  const header = dialog.getByRole('heading', { level: 2 });
  await expect(header.locator('.sr-only')).toHaveText('Addetto sportello');
  const description = dialog.locator('[data-posting-description]');
  await expect(description).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Precedente' }).click();
  await expect(header.locator('.sr-only')).not.toHaveText('Addetto sportello');
  await expect(description).toHaveCount(2);
  await expect(description).toHaveCount(1);
  await page.screenshot({ path: '/tmp/hub88-b-lavoro.png', animations: 'disabled' });
});

test('posting capture stacks and returns focus to the detail', async ({ page, pc }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk/ricerca');
  await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
  await page.getByText('Frontend Developer React').first().click();
  const key = new URL(page.url()).searchParams.get('job');
  const detail = page.getByRole('dialog', { name: 'Frontend Developer React' });
  await detail.getByRole('button', { name: 'Aggiungi', exact: true }).click();
  const capture = page.getByRole('dialog', { name: 'Nuovo post-it' });
  await expect(capture.getByText('Riguarda: Frontend Developer React')).toBeVisible();
  await expect(capture.locator('[data-modal-panel]')).toHaveCSS('opacity', '1');
  await page.screenshot({ path: '/tmp/hub71-lavoro-stacked.png' });
  await capture.getByRole('textbox', { name: 'Testo del post-it' }).fill('Promemoria annuncio');
  await page.keyboard.press('Enter');
  await expect(capture).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Aggiungi', exact: true })).toBeFocused();
  await expect(detail.getByText('Promemoria annuncio')).toBeVisible();
  await detail.getByRole('button', { name: 'Successiva' }).click();
  await expect(detail.getByText('Promemoria annuncio')).toHaveCount(0);
  const response = await pc.get('/trpc/notes.open');
  const notes: Array<{ id: string; text: string }> = (await response.json()).result.data;
  try {
    await pc.post('/trpc/layout.save', {
      data: { zone: 'overview', items: [{ widget: 'notes', size: 'wide', x: 0, y: 0 }] },
    });
    await page.goto('/desk');
    const card = page
      .getByRole('region', { name: 'Post-it', exact: true })
      .locator('li')
      .filter({ hasText: 'Promemoria annuncio' });
    await card.getByRole('link', { name: 'Frontend Developer React' }).click();
    await expect(page).toHaveURL((url) => url.searchParams.get('job') === key);
    await expect(page.getByRole('dialog', { name: 'Frontend Developer React' })).toBeVisible();
  } finally {
    for (const note of notes.filter((entry) => entry.text === 'Promemoria annuncio'))
      await pc.post('/trpc/notes.remove', { data: { id: note.id } });
    await pc.post('/trpc/layout.reset', { data: { zone: 'overview' } });
  }
});

/** Hold a hold-to-confirm button past its 800 ms by a real pointer. */
async function holdButton(
  page: { mouse: { down(): Promise<void>; up(): Promise<void> }; waitForTimeout(ms: number): Promise<void> },
  button: { hover(): Promise<void> },
) {
  await button.hover();
  await page.mouse.down();
  await page.waitForTimeout(1200);
  await page.mouse.up();
}

test('Oggi Lavoro links to review and the validated waiting segment', async ({ page, pc }) => {
  const link = { key: 'fake-interview-key', account: 'work', messageId: 'offer@example.org' };
  await pc.post('/trpc/lavoro.links.add', { data: link });
  try {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.route('**/trpc/mail.threads*', (route) =>
      route.fulfill({
        json: [
          {
            result: {
              data: {
                threads: [
                  {
                    account: 'work',
                    messageId: 'offer@example.org',
                    thread: {
                      waiting: true,
                      messages: [{ date: new Date(Date.now() - 10 * 86_400_000).toISOString() }],
                    },
                  },
                ],
                truncated: false,
                after: '',
              },
            },
          },
        ],
      }),
    );
    await page.goto('/desk/ricerca');
    await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
    // Esteso shows six lines (step 66): Largo's three would cut the waiting row behind "e altre N".
    await pc.post('/trpc/layout.save', {
      data: { zone: 'overview', items: [{ widget: 'today', size: 'full', x: 0, y: 0 }] },
    });
    await page.goto('/desk');
    await expect(page.getByRole('link', { name: /nuove da valutare/ })).toBeVisible();
    // Step 66: each part is an Oggi row with the chip "Lavoro".
    await expect(page.getByRole('link', { name: /nuove da valutare/ })).toContainText('Lavoro');
    await expect(page.getByRole('link', { name: /colloqu.*questa settimana/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /in attesa di risposta/ })).toHaveCount(0);
    await page.getByRole('link', { name: /nuove da valutare/ }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
    for (const old of ['waiting', 'active', 'invalid']) {
      await page.goto(`/desk/ricerca?tab=candidature&candidature=${old}`);
      await expect(page.getByRole('button', { name: /^In attesa/ })).toHaveAttribute('aria-pressed', 'true');
    }
  } finally {
    await pc.post('/trpc/layout.reset', { data: { zone: 'overview' } });
    await pc.post('/trpc/lavoro.links.remove', { data: { ...link, confirmed: true } });
  }
});

test('Oggi Lavoro omits waiting when mail is not configured', async ({ page }) => {
  const app = buildServer({ dbPath: ':memory:', config: emptyConfig, deps: { run: createFakeDesktop() } });
  try {
    const missing = await app.inject('/trpc/mail.accounts');
    await page.route('**/trpc/mail.accounts*', (route) =>
      route.fulfill({ status: missing.statusCode, body: missing.body, contentType: 'application/json' }),
    );
    await page.goto('/desk');
    await expect(page.getByRole('link', { name: /colloqu.*questa settimana/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /in attesa di risposta/ })).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('Profilo multilinea conserva gli a capo nelle impostazioni', async ({ page, pc }) => {
  const initial = { ...inventedProfile(), parere: { profile: 'Profilo inventato' } };
  const save = await pc.post('/trpc/settings.save', { data: { module: 'lavoro', enabled: true, value: initial } });
  expect(save.ok()).toBe(true);
  await expect
    .poll(async () => (await pc.get('/trpc/settings.modules').catch(() => null))?.ok() ?? false, { timeout: 30_000 })
    .toBe(true);
  await page.goto('/desk/settings/lavoro');
  const profile = page.getByRole('textbox', { name: 'Profilo', exact: true });
  await expect(profile).toHaveValue('Profilo inventato');
  await expect(profile).toHaveJSProperty('tagName', 'TEXTAREA');
  await profile.fill('Prima riga inventata\nSeconda riga inventata');
  await page.getByRole('button', { name: 'Salva e riavvia' }).click();
  await expect(page.getByText('Impostazioni salvate, Hub è di nuovo attivo')).toBeVisible({ timeout: 30_000 });
  const response = await pc.get(
    '/trpc/settings.config?input=' + encodeURIComponent(JSON.stringify({ module: 'lavoro' })),
  );
  expect((await response.json()).result.data.value.parere.profile).toBe('Prima riga inventata\nSeconda riga inventata');
});

test('Impostazioni: i punteggi si muovono di 1', async ({ page, pc }) => {
  const save = await pc.post('/trpc/settings.save', {
    data: { module: 'lavoro', enabled: true, value: inventedProfile() },
  });
  expect(save.ok()).toBe(true);
  await expect
    .poll(async () => (await pc.get('/trpc/settings.modules').catch(() => null))?.ok() ?? false, { timeout: 30_000 })
    .toBe(true);
  await page.goto('/desk/settings/lavoro');
  const min = page.getByRole('group', { name: 'Punteggio minimo', exact: true }).getByRole('status');
  await expect(min).toHaveText('5 punti');
  await page.getByRole('button', { name: 'Aumenta Punteggio minimo', exact: true }).click();
  await expect(min).toHaveText('6 punti');
});

test('Parere mostra e conserva il verdetto nella scheda', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk/ricerca');
  await page.getByRole('button', { name: 'Raccogli' }).click();
  await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
  await page.getByText('Frontend Developer React').first().click();
  const dialog = page.locator('dialog[open]');
  const block = dialog.getByRole('region', { name: 'Parere IA' });
  await block.getByRole('button', { name: 'Chiedi parere' }).click();
  for (const name of ['Verdetto', 'Fit', 'Contro', 'Prossimo passo', 'Non verificato']) {
    await expect(block.getByRole('heading', { name })).toBeVisible();
  }
  for (const label of ['Dominio', 'Sede', 'RAL'])
    await expect(block.getByText(label, { exact: true }).first()).toBeVisible();
  await expect(block.getByText('Ruolo coerente')).toBeVisible();
  await dialog.getByRole('button', { name: 'Chiudi' }).click();
  let releaseOpinion = () => {};
  const opinionPending = new Promise<void>((resolve) => {
    releaseOpinion = resolve;
  });
  await page.route('**/trpc/lavoro.opinion*', async (route) => {
    await opinionPending;
    await route.continue();
  });
  await page.getByText('Frontend Developer React').first().click();
  await expect(block.getByRole('button', { name: 'Chiedi parere' })).toHaveCount(0);
  await expect(block.getByRole('status', { name: 'Caricamento parere' })).toBeVisible();
  await dialog.locator('[data-modal-panel]').evaluate(async (panel) => {
    await Promise.all(panel.getAnimations().map((animation) => animation.finished));
  });
  // The sheet is centred on the screen, so a taller opinion moves the whole panel: measure the block from the panel top.
  const panel = dialog.locator('[data-modal-panel]');
  const inPanel = async () => {
    const [box, frame] = [await block.boundingBox(), await panel.boundingBox()];
    return box && frame ? { ...box, y: box.y - frame.y } : null;
  };
  const opinionBefore = await inPanel();
  releaseOpinion();
  await expect(block.getByRole('button', { name: 'Rifai' })).toBeVisible();
  await expect(block.getByText('Ruolo coerente')).toBeVisible();
  const opinionAfter = await inPanel();
  if (!opinionBefore || !opinionAfter) throw new Error('Opinion must be laid out');
  expect(Math.abs(opinionBefore.x - opinionAfter.x)).toBeLessThanOrEqual(8);
  expect(Math.abs(opinionBefore.y - opinionAfter.y)).toBeLessThanOrEqual(8);
  expect(Math.abs(opinionBefore.width - opinionAfter.width)).toBeLessThanOrEqual(8);
});

test('long source and empty location keep the card date on one line', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.route('**/trpc/*lavoro.list*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const reply of Array.isArray(body) ? body : [body]) {
      const jobs = reply.result?.data?.jobs;
      if (!Array.isArray(jobs)) continue;
      for (const job of jobs) {
        job.site = 'Un sito con un nome molto lungo che deve essere troncato nella scheda';
        job.company = 'Esempio Srl';
        job.location = '';
      }
    }
    await route.fulfill({ response, json: body });
  });
  await page.goto('/desk/ricerca');
  await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
  const card = page
    .locator('[data-posting-key]')
    .filter({ has: page.getByRole('heading', { name: 'Frontend Developer React' }) });
  await expect(card).toBeVisible();
  await expect(card.getByText('Esempio Srl', { exact: true })).toBeVisible();
  const date = card.locator('span.whitespace-nowrap').first();
  const dimensions = await date.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    lineHeight: Number.parseFloat(getComputedStyle(element).lineHeight),
  }));
  expect(Math.abs(dimensions.height - dimensions.lineHeight)).toBeLessThan(1);
});

test('Parere indica quando mancano chiave e profilo', async ({ page }) => {
  await page.goto('/desk/ricerca');
  await page.getByRole('button', { name: 'Raccogli' }).click();
  await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
  await page.getByText('Frontend Developer React').first().click();
  await page.route('**/trpc/lavoro.requestOpinion*', (route) =>
    route.fulfill({
      status: 412,
      json: { error: { message: 'Inserisci chiave e profilo nelle impostazioni', code: -32012 } },
    }),
  );
  const block = page.locator('dialog[open]').getByRole('region', { name: 'Parere IA' });
  await block.getByRole('button', { name: /^(Chiedi parere|Rifai)$/ }).click();
  await expect(block.getByRole('alert')).toContainText('Inserisci chiave e profilo nelle impostazioni');
  await expect(block.getByRole('link', { name: 'Impostazioni' })).toHaveAttribute('href', '/desk/settings/lavoro');
});

test('Pareri mancanti shows progress and does not start twice', async ({ page, pc }) => {
  await page.goto('/desk/ricerca');
  await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
  // The count shows before the collection ends; its final refresh would close a menu opened earlier.
  await expect(page.getByRole('button', { name: /^Attività in corso: .*Raccogli annunci/ })).toHaveCount(0);
  const more = page.getByRole('button', { name: 'Altre azioni di raccolta' });
  await more.click();
  await page.getByRole('menuitem', { name: /^Pareri mancanti \(\d+\)$/ }).click();
  await expect(page.getByRole('status').filter({ hasText: /^Pareri \d+ di \d+$/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Attività in corso: .*Pareri/ })).toBeVisible();
  await more.click();
  await expect(page.getByRole('menuitem', { name: /^Pareri \d+ di \d+$/ })).toBeDisabled();
  await page.keyboard.press('Escape');
  const second = await pc.post('/trpc/lavoro.pareriMancanti', { data: {} });
  expect((await second.json()).result.data.started).toBe(false);
  await page.getByRole('button', { name: /^Attività in corso: .*Pareri/ }).click();
  await page.getByRole('button', { name: 'Apri Pareri', exact: true }).click();
  await expect(page).toHaveURL(/\/desk\/system\?tab=jobs$/);
  await expect(page.getByRole('button', { name: /lavoro\.pareri In esecuzione/ })).toBeVisible();
});

test('a verdict appears beside the score in cards and rows', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk/ricerca');
  await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
  await page.getByText('Frontend Developer React').first().click();
  const dialog = page.locator('dialog[open]');
  await dialog.getByRole('button', { name: /Chiedi parere|Rifai/ }).click();
  await expect(dialog.getByRole('button', { name: 'Rifai' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Chiudi' }).click();
  const card = page.locator('[data-posting-key]').filter({ hasText: 'Frontend Developer React' });
  await expect(card.getByRole('img', { name: 'Parere: Possibilità alta, motivi Dominio, RAL' })).toBeVisible();
  await page.getByRole('button', { name: 'Opzioni vista' }).click();
  await page.getByRole('button', { name: 'Righe' }).click();
  await expect(card.getByRole('img', { name: 'Parere: Possibilità alta, motivi Dominio, RAL' })).toBeVisible();
});

test('verdict variants remain readable in the 4K posting list', async ({ page, pc }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk/ricerca?sort=score');
  await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
  const rows = (await (await pc.get('/trpc/lavoro.list')).json()).result.data.jobs;
  const ask = rows.find((job: { title: string }) => job.title === 'Web Developer Junior');
  const reject = rows.find((job: { title: string }) => job.title === 'Fullstack Developer Web');
  await pc.post('/trpc/lavoro.requestOpinion', { data: { key: ask.key, redo: true } });
  await pc.post('/trpc/lavoro.requestOpinion', { data: { key: reject.key, redo: true } });
  await pc.post('/trpc/lavoro.edit', {
    data: { key: ask.key, job: { description: 'Descrizione inventata modificata' } },
  });
  await page.reload();
  const askCard = page.locator('[data-posting-key]').filter({ hasText: 'Web Developer Junior' });
  const rejectCard = page.locator('[data-posting-key]').filter({ hasText: 'Fullstack Developer Web' });
  const badge = askCard.getByRole('img', { name: 'Parere: Possibilità media, motivi Dominio' });
  await expect(badge).toHaveClass(/opacity-50/);
  await badge.hover();
  await expect(page.getByRole('tooltip')).toHaveText('Da aggiornare');
  const rejected = rejectCard.getByRole('img', { name: /Parere: Possibilità bassa/ });
  await expect(rejected).toBeVisible();
  await expect(rejected).not.toHaveClass(/danger/);
  await expect(askCard.getByText('Non detto: Azienda', { exact: true })).toBeVisible();
  await page.screenshot({ path: '/tmp/hub-23p3-cards.png' });
  await page.getByRole('button', { name: 'Opzioni vista' }).click();
  await page.getByRole('button', { name: 'Righe' }).click();
  await page.keyboard.press('Escape');
  await expect(askCard.getByRole('img', { name: /Parere: Possibilità media/ })).toBeVisible();
  await page.screenshot({ path: '/tmp/hub-23p3-rows.png' });
  await pc.post('/trpc/lavoro.edit', { data: { key: ask.key, job: { description: ask.description } } });
});

test('the empty state does not show while the first list is loading', async ({ page }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/trpc/*lavoro.list*', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/desk/ricerca');
  await expect(page.getByRole('button', { name: 'Altre azioni di raccolta' })).toBeVisible();
  await expect(page.getByText('Nessuna offerta da valutare')).toHaveCount(0);
  release();
  await expect(page.getByRole('button', { name: /^Da valutare/ })).toBeVisible();
});

test.describe('Ricerca lavoro zone (read-only)', () => {
  test('full reading, exact counts, filtering, keyboard navigation, prova and annulla', async ({ page }) => {
    await page.goto('/desk/ricerca?sort=score');
    await expect(page.getByRole('heading', { level: 1, name: 'Ricerca lavoro' })).toBeVisible();

    // 2. Run real collection ("Raccogli") and wait for completion
    const raccogliBtn = page.getByRole('button', { name: 'Raccogli' });
    await expect(raccogliBtn).toBeVisible();
    await raccogliBtn.click();

    // Wait until collection completes and all 6 non-blacklisted jobs appear in Da valutare
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Escluse 1' })).toBeVisible();
    // Favourites were removed (16n2): no segment for them.
    await expect(page.getByRole('button', { name: /^Preferiti/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Archiviate 0' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Eliminate 0' })).toBeVisible();

    // 4. Free search with phrases and exclusions: "Frontend Developer" -Vue
    const searchInput = page.getByPlaceholder(/Cerca annunci/);
    // "/" focuses the search box from anywhere on the page
    await expect(searchInput).not.toBeFocused();
    await page.keyboard.press('/');
    await expect(searchInput).toBeFocused();
    await searchInput.fill('"Frontend Developer" -Vue');
    await expect(page.getByText('Frontend Developer React')).toBeVisible();
    await expect(page.getByText('Frontend Engineer Vue')).toHaveCount(0);
    // Highlight check: <mark> on matched words
    await expect(page.locator('mark').first()).toBeVisible();

    // The clear button empties the box and restores excluded items
    await page.getByRole('button', { name: 'Cancella ricerca' }).click();
    await expect(searchInput).toHaveValue('');
    await expect(page.getByText('Frontend Engineer Vue')).toBeVisible();

    // 5. Filter popover with exact counts and exclusion verification
    const filterBtn = page.getByRole('button', { name: /Filtri/ });
    const popover = page.getByRole('dialog', { name: 'Filtri annunci' });
    await filterBtn.click();
    await expect(popover).toBeVisible();
    await expect(page.getByText('Modalità di lavoro')).toBeVisible();

    // Check exact filter button counts
    const remoteBtn = page.getByRole('button', { name: 'Da remoto (3)' });
    await expect(remoteBtn).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ibrido (1)' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'In sede (2)' })).toBeVisible();

    // Filter by Da remoto
    await remoteBtn.click();
    await expect(page).toHaveURL(/modes=remote/);
    await expect(page.getByText('Frontend Developer React')).toBeVisible();
    await expect(page.getByText('Frontend Engineer Vue')).toBeVisible();
    await expect(page.getByText('Senior Frontend Architect')).toBeVisible();
    // Negative checks: onsite and hybrid jobs are excluded
    await expect(page.getByText('Fullstack Developer Web')).toHaveCount(0);
    await expect(page.getByText('Web Developer Junior')).toHaveCount(0);

    // A select opened inside the popover: picking a value must not dismiss the popover
    await popover.getByRole('button', { name: /^Prima rilevazione:/ }).click();
    await page.getByRole('option', { name: '7 giorni' }).click();
    await expect(page).toHaveURL(/fs=7d/);
    // aria-expanded flips the moment the popover is dismissed, before its exit animation ends
    await expect(filterBtn).toHaveAttribute('aria-expanded', 'true');
    await expect(popover).toBeVisible();
    await expect(popover.getByRole('button', { name: 'Prima rilevazione: 7 giorni' })).toBeVisible();

    // Escape closes the popover and gives focus back to its trigger
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(filterBtn).toBeFocused();

    // A chip removes its filter by click and the URL follows
    const modeChip = page.getByRole('button', { name: 'Rimuovi Da remoto' });
    await expect(modeChip).toBeVisible();
    await modeChip.click();
    await expect(page).not.toHaveURL(/modes=/);
    await expect(modeChip).toHaveCount(0);
    await expect(page.getByText('Fullstack Developer Web')).toBeVisible();
    await expect(page.getByText('Web Developer Junior')).toBeVisible();

    // ...and by Backspace on the focused chip
    await filterBtn.click();
    await remoteBtn.click();
    await expect(page).toHaveURL(/modes=remote/);
    await expect(page.getByText('Fullstack Developer Web')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await modeChip.focus();
    await page.keyboard.press('Backspace');
    await expect(page).not.toHaveURL(/modes=/);
    await expect(modeChip).toHaveCount(0);
    await expect(page.getByText('Fullstack Developer Web')).toBeVisible();

    // Clear all filters restores excluded jobs and drops the other filters too
    await filterBtn.click();
    await remoteBtn.click();
    await expect(page.getByText('Fullstack Developer Web')).toHaveCount(0);
    await page.getByRole('button', { name: 'Azzera filtri' }).click();
    await expect(page).not.toHaveURL(/modes=|fs=/);
    await expect(page.getByText('Fullstack Developer Web')).toBeVisible();
    await expect(page.getByText('Web Developer Junior')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();

    // 6. Sort: the order changes with the select and the URL carries the value
    const titles = () => page.getByRole('heading', { level: 4 }).allTextContents();
    const byScore = await titles();
    await page.getByRole('button', { name: /^Ordina:/ }).click();
    await page.getByRole('option', { name: 'Azienda A-Z' }).click();
    await expect(page).toHaveURL(/sort=company/);
    const byCompany = [
      'Frontend Developer React', // Acme Corp
      'Addetto sportello', // Banca Esempio S.p.A.
      'Web Developer Junior', // Beta Systems
      'Fullstack Developer Web', // Delta Solutions
      'Frontend Engineer Vue', // Gamma Tech
      'Senior Frontend Architect', // Gamma Tech S.r.l.
    ];
    await expect.poll(titles).toEqual(byCompany);
    expect(byScore).not.toEqual(byCompany);

    // 6b. Tooltips on the icon buttons appear on hover and the names stay
    for (const name of ['Cerca in tutti i segmenti', 'Ricerca avanzata', 'Opzioni vista']) {
      const button = page.getByRole('button', { name });
      await button.hover();
      await expect(page.getByRole('tooltip', { name })).toBeVisible();
      await expect(button).toHaveAccessibleName(name);
    }
    await expect(page.getByRole('button', { name: 'Raccogli', exact: true })).toBeVisible();

    // 6c. View options: the description switch hides the description on the cards
    const cardDescription = page.getByText('Junior web developer for UI components');
    await expect(cardDescription).toBeVisible();
    await page.getByRole('button', { name: 'Opzioni vista' }).click();
    const descriptionSwitch = page.getByRole('switch', { name: 'Descrizione' });
    await expect(descriptionSwitch).toHaveAttribute('aria-checked', 'true');
    await descriptionSwitch.click();
    await expect(descriptionSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(cardDescription).toHaveCount(0);
    await descriptionSwitch.click();
    await expect(cardDescription).toBeVisible();
    await page.keyboard.press('Escape');

    // 7. Detail modal, exact position indicator, next button and keyboard arrows
    const firstJob = page.getByText('Frontend Developer React').first();
    await firstJob.click();
    await expect(page).toHaveURL(/job=/);
    const openedUrl = new URL(page.url());
    const jobKey = openedUrl.searchParams.get('job')!;

    const dialog = page.locator('dialog[open]').first();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('1 di 6')).toBeVisible();

    // Next arrow navigation via button
    const nextBtn = dialog.getByRole('button', { name: 'Successiva' });
    await nextBtn.click();
    await expect(dialog.getByText('2 di 6')).toBeVisible();

    // Arrow navigation via keyboard
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByText('3 di 6')).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    await expect(dialog.getByText('2 di 6')).toBeVisible();

    // Browser Back closes detail
    await page.goBack();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page).not.toHaveURL(/job=/);

    // Escape closes the detail and drops ?job=
    await page.getByText('Frontend Developer React').first().click();
    await expect(page.locator('dialog[open]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page).not.toHaveURL(/job=/);

    // Closing a detail opened from a card goes back in the history: no duplicate entry is left behind
    const entryIndex = () => page.evaluate(() => navigation.currentEntry?.index);
    const indexBefore = await entryIndex();
    expect(indexBefore).toBeDefined();
    await page.getByText('Frontend Developer React').first().click();
    await expect(page).toHaveURL(/job=/);
    await expect.poll(entryIndex).toBe((indexBefore ?? 0) + 1);
    await page.locator('dialog[open]').getByRole('button', { name: 'Chiudi' }).click();
    await expect(page).not.toHaveURL(/job=/);
    await expect.poll(entryIndex).toBe(indexBefore);

    // 8. Direct URL to job detail and close without leaving app
    await page.goto(`/desk/ricerca?job=${encodeURIComponent(jobKey)}`);
    const directDialog = page.locator('dialog[open]').first();
    await expect(directDialog).toBeVisible();
    await directDialog.getByRole('button', { name: 'Chiudi' }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page).toHaveURL(/\/desk\/ricerca$/);

    // 9. URL round trip: reload keeps state
    await page.getByRole('button', { name: 'Escluse 1' }).click();
    await expect(page).toHaveURL(/segment=blacklisted/);
    await page.reload();
    await expect(page).toHaveURL(/segment=blacklisted/);

    // 10. Escluse posting shows rule label
    await expect(page.getByText('Zeta Mobile • Examplia North')).toBeVisible();
    await expect(page.getByText(/In blacklist per la regola #1: Zeta Mobile/)).toBeVisible();

    // Return to Da valutare
    await page.getByRole('button', { name: 'Da valutare 6' }).click();

    // 11. Collection progress and Annulla control. The fake sources wait while the hold file exists, so the
    // collection is still running when Annulla is pressed, however loaded the machine is (it flaked under the
    // parallel verify, 2026-11-16).
    writeFileSync(holdFile, '');
    try {
      await page.getByRole('button', { name: 'Raccogli' }).click();
      const annullaBtn = page.getByRole('button', { name: 'Annulla' });
      await expect(annullaBtn).toBeVisible({ timeout: 5000 });
      await expect(page.getByText('Raccolta in corso...')).toBeVisible();
      // The activity ball names the collection while it runs (the panel is covered by the public activity spec).
      const ball = page.getByRole('button', { name: /^Attività in corso: .*Raccogli annunci/ });
      await expect(ball).toBeVisible();
      await annullaBtn.click();
      await expect(annullaBtn).toHaveCount(0, { timeout: 5000 });
    } finally {
      rmSync(holdFile, { force: true });
    }
  });

  test('detail summary rows and hand-drawn marks: drawn once, replaced on the next posting, gone on close', async ({
    page,
  }) => {
    await page.goto('/desk/ricerca?sort=score');
    await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible({ timeout: 10000 });

    // The Stabile clerk: salary and a permanent contract in favour, on-site to weigh, nothing rules it out.
    await page.getByText('Addetto sportello').first().click();
    const detail = page.locator('dialog[open]').first();
    await expect(detail).toBeVisible();
    const favor = detail.getByRole('group', { name: 'A favore' });
    await expect(favor).toContainText('Retribuzione 1.800 - 2.000 €/m');
    await expect(favor).toContainText('Contratto a tempo indeterminato');
    await expect(detail.getByRole('group', { name: 'Da valutare' })).toContainText('In sede');
    // An empty row is not shown.
    await expect(detail.getByRole('group', { name: 'Ti esclude' })).toHaveCount(0);
    // The values of the rows line up in one column, whatever the label's width. Both are read in one frame: the dialog
    // is still growing in, and two separate reads caught two different frames (flaky in the 16q gate).
    const [consider, favorX] = await detail.evaluate((dialog) =>
      ['Da valutare', 'A favore'].map((name) => {
        const values = dialog.querySelector(`[role="group"][aria-label="${name}"]`)?.querySelectorAll('span');
        return Math.round(values?.[values.length - 1]?.getBoundingClientRect().x ?? -1);
      }),
    );
    expect(consider).toBe(favorX);

    const marks = detail.locator('[data-mark]');
    const drawings = detail.locator('svg.rough-annotation');
    await expect(drawings.first()).toBeAttached();
    expect(await marks.count()).toBeGreaterThanOrEqual(3);
    // One drawing per marked word, all hidden from assistive technology (the summary says the same in text).
    await expect.poll(async () => drawings.count()).toBe(await marks.count());
    await expect(detail.locator('svg.rough-annotation:not([aria-hidden="true"])')).toHaveCount(0);
    expect(await detail.locator('mark').count()).toBe(0);
    // Drawn with the animation on.
    expect(
      await drawings
        .locator('path')
        .evaluateAll((paths) => paths.filter((p) => p instanceof SVGElement && p.style.animation !== '').length),
    ).toBeGreaterThan(0);

    // The next posting replaces the drawings, it never stacks them on the old ones.
    await detail.getByRole('button', { name: 'Precedente' }).click();
    await expect(detail.getByText('5 di 6')).toBeVisible();
    await expect(detail.locator('[data-posting-description]')).toHaveCount(1);
    await expect(detail.locator('[data-mark]')).toHaveCount(1);
    await expect.poll(async () => drawings.count()).toBe(1);
    await expect(detail.getByText('Addetto sportello')).toHaveCount(0);

    // Closing removes every drawing.
    await detail.getByRole('button', { name: 'Chiudi' }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('svg.rough-annotation')).toHaveCount(0);
  });

  test('a posting with a negative reason lists it under Ti esclude and circles the word', async ({ page }) => {
    await page.goto('/desk/ricerca');
    await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible({ timeout: 10000 });
    await page.getByText('Senior Frontend Architect').first().click();
    const detail = page.locator('dialog[open]').first();
    await expect(detail.getByRole('group', { name: 'Ti esclude' })).toContainText('senior');
    await expect(detail.locator('[data-mark="exclude"]').first()).toHaveText(/senior/i);
    await expect(detail.locator('svg.rough-annotation').first()).toBeAttached();
  });

  test('with reduced motion the marks are there but nothing is animated', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/desk/ricerca');
    await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible({ timeout: 10000 });
    await page.getByText('Addetto sportello').first().click();
    const drawings = page.locator('dialog[open] svg.rough-annotation');
    await expect(drawings.first()).toBeAttached();
    // The desk CSS also stops animations under reduced motion, so look at what the component asked for.
    expect(
      await drawings
        .locator('path')
        .evaluateAll((paths) => paths.filter((p) => p instanceof SVGElement && p.style.animation !== '').length),
    ).toBe(0);
    expect(
      await page.locator('dialog[open]').evaluate((dialog) => dialog.getAnimations({ subtree: true }).length),
    ).toBe(0);
  });

  test('status line shows Ultima raccolta when collection finishes', async ({ page }) => {
    await page.goto('/desk/ricerca');
    await page.getByRole('button', { name: 'Raccogli' }).click();
    await expect(page.getByText(/Ultima raccolta:/)).toBeVisible({ timeout: 10000 });
  });

  test('error state on list failure with Riprova', async ({ page }) => {
    let fail = true;
    await page.route('**/trpc/lavoro.list*', async (route) => {
      if (fail) {
        await route.fulfill({ status: 500, json: { error: { message: 'Forced server failure' } } });
      } else {
        await route.continue();
      }
    });
    await page.goto('/desk/ricerca');
    await expect(page.getByText('Errore nel caricamento delle offerte')).toBeVisible();
    await expect(page.getByText('Nessuna offerta da valutare')).toHaveCount(0);
    fail = false;
    await page.getByRole('button', { name: 'Riprova' }).click();
    await expect(page.getByText('Errore nel caricamento delle offerte')).toHaveCount(0);
  });

  test('the Raccogli menu lists only the actions that apply', async ({ page }) => {
    await page.goto('/desk/ricerca');
    await page.getByRole('button', { name: 'Altre azioni di raccolta' }).click();
    const menu = page.getByRole('menu', { name: 'Altre azioni di raccolta' });
    await expect(menu.getByRole('menuitem', { name: 'Importa da link' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: /^Pareri/ })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });

  test('single actions from card, row and detail with undo and detail advancement', async ({ page }) => {
    await page.goto('/desk/ricerca?sort=score');
    await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible({ timeout: 10000 });

    // 1. Archive from Card with Toast Undo
    const archiveBtn = page.getByRole('button', { name: 'Archivia Frontend Developer React' });
    await archiveBtn.click();
    await expect(page.getByRole('button', { name: 'Da valutare 5' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archiviate 1' })).toBeVisible();
    await expect(page.getByText('Frontend Developer React')).toHaveCount(0);
    // Toast with Undo
    const toast = page.locator('[data-toast]');
    await expect(toast).toContainText('Offerta archiviata');
    await toast.getByRole('button', { name: 'Annulla' }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archiviate 0' })).toBeVisible();
    await expect(page.getByText('Frontend Developer React')).toBeVisible();

    // 2. No favourite button on the card: the feature was removed (16n2), the other actions are still there
    await expect(page.getByRole('button', { name: /^Preferito / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Archivia Frontend Developer React' })).toBeVisible();

    // 3. Apply toggle with Toast Undo (moves out of Da valutare, undo restores)
    const applyBtn = page.getByRole('button', { name: 'Candidato Frontend Developer React' });
    await applyBtn.click();
    await expect(toast).toContainText('Candidatura registrata');
    await expect(page.getByRole('button', { name: 'Da valutare 5' })).toBeVisible();
    await expect(page.getByText('Frontend Developer React')).toHaveCount(0);
    await toast.getByRole('button', { name: 'Annulla' }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
    await expect(page.getByText('Frontend Developer React')).toBeVisible();

    // 4. Trash from Row layout with Undo
    await page.getByRole('button', { name: 'Opzioni vista' }).click();
    await page.getByRole('button', { name: 'Righe' }).click();
    await page.keyboard.press('Escape');

    const trashBtn = page.getByRole('button', { name: 'Cestino Frontend Developer React' });
    await trashBtn.click();
    await expect(page.getByRole('button', { name: 'Da valutare 5' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Eliminate 1' })).toBeVisible();
    await toast.getByRole('button', { name: 'Annulla' }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Eliminate 0' })).toBeVisible();

    // 5. Detail: Apply stays on the job; Archive advances to next job automatically
    await page.getByText('Frontend Developer React').first().click();
    const detailDialog = page.locator('dialog[open]').first();
    await expect(detailDialog).toBeVisible();
    await expect(detailDialog.getByText('2 di 6')).toBeVisible();

    // Apply inside detail stays on the same job
    const detailApplyBtn = detailDialog.getByRole('button', { name: 'Candidato', exact: true });
    await detailApplyBtn.click();
    await expect(toast).toContainText('Candidatura registrata');
    await expect(detailDialog).toBeVisible();
    await expect(detailDialog.getByText('Frontend Developer React')).toBeVisible();
    await expect(detailApplyBtn).toHaveAttribute('aria-pressed', 'true');
    await toast.getByRole('button', { name: 'Annulla' }).click();
    await expect(detailApplyBtn).toHaveAttribute('aria-pressed', 'false');

    // Archive from inside detail
    await detailDialog.getByRole('button', { name: 'Archivia', exact: true }).click();
    // Detail should not close; instead it smoothly shows the next job (Fullstack Developer Web)
    await expect(detailDialog).toBeVisible();
    await expect(detailDialog.getByText('Fullstack Developer Web')).toBeVisible();
    await expect(detailDialog.getByText('2 di 5')).toBeVisible();

    // Undo via toast; the next specs share the server, so wait for the write, not only the optimistic count.
    const undone = page.waitForResponse((r) => r.url().includes('lavoro.setFlag'));
    await toast.getByRole('button', { name: 'Annulla' }).click();
    await undone;
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
    await detailDialog.getByRole('button', { name: 'Chiudi' }).click();
  });

  test('detail: opinion beside the posting, only the posting scrolls, named actions', async ({ page }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.goto('/desk/ricerca');
    await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
    await page.getByText('Frontend Developer React').first().click();
    const dialog = page.locator('dialog[open]').first();
    await dialog.getByRole('button', { name: /^(Chiedi parere|Rifai)$/ }).click();
    await expect(dialog.getByRole('heading', { name: 'Verdetto' })).toBeVisible();
    const headings = async () => {
      const opinion = await dialog.getByRole('heading', { name: 'Parere IA' }).boundingBox();
      const listing = await dialog.getByRole('heading', { name: 'Annuncio' }).boundingBox();
      return { opinion: opinion!, listing: listing! };
    };
    const { opinion, listing } = await headings();
    expect(opinion.x).toBeLessThan(listing.x);
    // Measured once the request has settled and the dialog has stopped moving: under load the opening animation was
    // still running and two reads came out 6.4 and 6.9 px apart (verify 2026-11-16).
    await expect(dialog.getByRole('region', { name: 'Parere IA' })).toHaveAttribute('aria-busy', 'false');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity).length,
        ),
      )
      .toBe(0);
    await expect
      .poll(async () => {
        const now = await headings();
        return Math.abs(now.opinion.y - now.listing.y);
      })
      .toBeLessThanOrEqual(4);

    // Make the posting taller than the column, then scroll it: the opinion stays.
    const column = dialog.getByRole('heading', { name: 'Annuncio' }).locator('xpath=../..');
    await column.evaluate((element) => {
      const filler = document.createElement('div');
      filler.style.height = '6000px';
      filler.style.flexShrink = '0';
      element.append(filler);
    });
    const verdict = dialog.getByRole('heading', { name: 'Verdetto' });
    await expect(verdict).toBeVisible();
    const before = await verdict.boundingBox();
    await column.evaluate((element) => element.scrollTo(0, 500));
    await expect.poll(() => column.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect((await verdict.boundingBox())!.y).toBe(before!.y);

    for (const name of ['Candidato', 'Archivia', 'Cestina', 'Modifica', "Escludi l'azienda"]) {
      await expect(dialog.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await dialog.getByRole('button', { name: 'Chiudi' }).click();
  });

  test('detail: a posting without an opinion keeps the request control in the left column', async ({ page }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.route('**/trpc/lavoro.opinion*', (route) => route.fulfill({ json: [{ result: { data: null } }] }));
    await page.goto('/desk/ricerca');
    await page.getByText('Frontend Developer React').first().click();
    const dialog = page.locator('dialog[open]').first();
    const ask = await dialog.getByRole('button', { name: 'Chiedi parere' }).boundingBox();
    const listing = await dialog.getByRole('heading', { name: 'Annuncio' }).boundingBox();
    expect(ask!.x).toBeLessThan(listing!.x);
    await dialog.getByRole('button', { name: 'Chiudi' }).click();
  });

  test('detail: below 1100px the opinion sits above the posting', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 });
    await page.goto('/desk/ricerca');
    await page.getByText('Frontend Developer React').first().click();
    const dialog = page.locator('dialog[open]').first();
    const opinion = await dialog.getByRole('heading', { name: 'Parere IA' }).boundingBox();
    const listing = await dialog.getByRole('heading', { name: 'Annuncio' }).boundingBox();
    expect(opinion!.y).toBeLessThan(listing!.y);
    await dialog.getByRole('button', { name: 'Chiudi' }).click();
  });

  test('detail: C marks the application, but not while typing in Modifica', async ({ page }) => {
    await page.goto('/desk/ricerca');
    await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
    await page.getByText('Frontend Developer React').first().click();
    const dialog = page.locator('dialog[open]').first();
    await dialog.getByRole('button', { name: 'Modifica', exact: true }).click();
    const edit = page.locator('dialog[open]').nth(1);
    const title = edit.getByLabel('Titolo');
    await title.focus();
    await page.keyboard.press('c');
    await expect(title).toHaveValue(/c$/);
    await edit.getByRole('button', { name: 'Chiudi' }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Candidato', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    await dialog.getByRole('heading', { name: 'Annuncio' }).click();
    await page.keyboard.press('c');
    await expect(page.getByRole('button', { name: 'Da valutare 5' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Candidato', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    const undone = page.waitForResponse((r) => r.url().includes('lavoro.setFlag'));
    await page.locator('[data-toast]').getByRole('button', { name: 'Annulla' }).click();
    await undone;
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Chiudi' }).click();
  });

  test('detail: Claude and Codex candidatura prompts copy on desk only, nothing spawned', async ({
    page,
    context,
    pc,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.setViewportSize({ width: 3840, height: 2160 });
    const readCore = async () => (await (await pc.get('/trpc/settings.core')).json()).result.data.value;
    const readRuntimeClient = async () => (await (await pc.get(`${SERVER_URL}/__fake/core`)).json()).mcpClient;
    const original = await readCore();
    try {
      let opened = 0;
      // The real action would start a terminal on the PC: the route answers instead and only counts.
      await page.route('**/trpc/lavoro.openCandidatura*', (route) => {
        opened++;
        return route.fulfill({ json: [{ result: { data: null } }] });
      });
      await page.goto('/desk/ricerca');
      await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
      await page.getByText('Frontend Developer React').first().click();
      const dialog = page.locator('dialog[open]').first();
      await expect(dialog.getByRole('button', { name: 'Prepara candidatura', exact: true })).toBeVisible();
      await dialog.getByRole('button', { name: 'Copia comando', exact: true }).click();
      const rows = (await (await pc.get('/trpc/lavoro.list')).json()).result.data.jobs;
      const key = rows.find((job: { title: string; key: string }) => job.title === 'Frontend Developer React')?.key;
      expect(key).toBeTruthy();
      const prompt = (
        await (
          await pc.get(`/trpc/lavoro.candidaturaPrompt?input=${encodeURIComponent(JSON.stringify({ key }))}`)
        ).json()
      ).result.data;
      expect(prompt).toBe(`/candidatura ${postingId(key)}`);
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
      await pc.post('/trpc/settings.saveCore', { data: { ...original, mcp: { ...original.mcp, client: 'codex' } } });
      await expect.poll(async () => readRuntimeClient().catch(() => null), { timeout: 30_000 }).toBe('codex');
      await dialog.getByRole('button', { name: 'Copia comando', exact: true }).click();
      const codexPrompt = (
        await (
          await pc.get(`/trpc/lavoro.candidaturaPrompt?input=${encodeURIComponent(JSON.stringify({ key }))}`)
        ).json()
      ).result.data;
      expect(codexPrompt).toContain('SKILL.md');
      expect(codexPrompt).toContain(postingId(key));
      expect(codexPrompt).not.toContain(key);
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(codexPrompt);

      await dialog.getByRole('button', { name: 'Modifica', exact: true }).click();
      const edit = page.locator('dialog[open]').nth(1);
      const title = edit.getByLabel('Titolo');
      await title.focus();
      await page.keyboard.press('p');
      await expect(title).toHaveValue(/p$/);
      expect(opened).toBe(0);
      await edit.getByRole('button', { name: 'Chiudi' }).click();

      await dialog.getByRole('heading', { name: 'Annuncio' }).click();
      await page.keyboard.press('p');
      await expect.poll(() => opened).toBe(1);
      await dialog.getByRole('button', { name: 'Chiudi' }).click();
    } finally {
      await pc.post('/trpc/settings.saveCore', { data: original });
      await expect
        .poll(async () => readRuntimeClient().catch(() => null), { timeout: 30_000 })
        .toBe(original.mcp.client);
    }
  });

  test('a list answer already in flight cannot undo an archive', async ({ page }) => {
    await page.goto('/desk/ricerca');
    await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible({ timeout: 10000 });

    // Hold the answer of the next list request after the server has given it: it still lists the posting as unarchived.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let fetched!: () => void;
    const staleRead = new Promise<void>((resolve) => (fetched = resolve));
    let holdNext = true;
    await page.route('**/trpc/lavoro.list*', async (route) => {
      if (!holdNext) return route.continue();
      holdNext = false;
      const response = await route.fetch();
      fetched();
      await gate;
      await route.fulfill({ response });
    });

    // A second collection finishing makes the zone read the list again; that read is the held one.
    await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
    await staleRead;

    const archived = page.waitForResponse((r) => r.url().includes('lavoro.setFlag'));
    await page.getByRole('button', { name: 'Archivia Frontend Developer React' }).click();
    await archived;
    await expect(page.getByRole('button', { name: 'Da valutare 5' })).toBeVisible();

    // Let the old answer through, then wait on a request made after it: by then the page has handled it.
    const stale = page.waitForResponse((r) => r.url().includes('lavoro.list'));
    release();
    await stale;
    await page.evaluate(() => fetch('/trpc/health').then(() => undefined));

    await expect(page.getByRole('button', { name: 'Da valutare 5' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archiviate 1' })).toBeVisible();
    await expect(page.getByText('Frontend Developer React')).toHaveCount(0);

    // Undo so the next specs find the server as it was (6 to evaluate): wait for the write, not only the optimistic count.
    const undone = page.waitForResponse((r) => r.url().includes('lavoro.setFlag'));
    await page.locator('[data-toast]').getByRole('button', { name: 'Annulla' }).click();
    await undone;
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archiviate 0' })).toBeVisible();
  });

  test('optimistic rollback on forced mutation failure', async ({ page }) => {
    await page.goto('/desk/ricerca');
    await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible({ timeout: 10000 });

    // Intercept setFlag and force a 500 error
    await page.route('**/trpc/lavoro.setFlag*', (route) =>
      route.fulfill({ status: 500, json: { error: { message: 'Server explosion' } } }),
    );

    const archiveBtn = page.getByRole('button', { name: 'Archivia Frontend Developer React' });
    await archiveBtn.click();

    // Toast error appears and job rolls back into view
    await expect(page.getByText('Operazione non riuscita')).toBeVisible();
    await expect(page.getByText('Frontend Developer React')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
  });

  test('group archive with filter and confirmation', async ({ page }) => {
    await page.goto('/desk/ricerca');
    await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible({ timeout: 10000 });

    // Filter by Da remoto (3 jobs)
    await page.getByRole('button', { name: /Filtri/ }).click();
    await page.getByRole('button', { name: 'Da remoto (3)' }).click();
    await page.keyboard.press('Escape');

    // Group action button visible only with filter
    const groupBtn = page.getByRole('button', { name: 'Archivia queste 3' });
    await expect(groupBtn).toBeVisible();
    await groupBtn.click();

    // Confirmation dialog
    const confirmDialog = page.getByRole('dialog', { name: 'Confermi di voler archiviare 3 offerte?' });
    await expect(confirmDialog).toBeVisible();
    await confirmDialog.getByRole('button', { name: 'Conferma' }).click();
    await expect(confirmDialog).toHaveCount(0);

    // All 3 remote jobs archived
    await expect(page.getByRole('button', { name: 'Da valutare 3' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archiviate 3' })).toBeVisible();

    // Undo restores all 3
    const toast = page.locator('[data-toast]');
    await expect(toast).toContainText('3 offerte archiviate');
    await toast.getByRole('button', { name: 'Annulla' }).click();
    await expect(toast).toContainText('3 offerte ripristinate');
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Archiviate 0' })).toBeVisible();
  });

  test('the categories filter offers Stabile and leaves only its postings', async ({ page }) => {
    await page.goto('/desk/ricerca');
    await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: /Filtri/ }).click();
    await page.getByRole('button', { name: 'Stabile (1)' }).click();
    await expect(page).toHaveURL(/cats=Stabile/);
    await page.keyboard.press('Escape');

    await expect(page.getByRole('heading', { level: 4 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 4, name: 'Addetto sportello' })).toBeVisible();
    await expect(page.getByText('Frontend Developer React')).toHaveCount(0);
  });

  test('purge dialog with initial focus on Annulla, hold to confirm and permanent exclusion', async ({ page, pc }) => {
    await page.goto('/desk/ricerca');
    await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Ultima raccolta: oggi/)).toBeVisible();

    const rows: Array<{ key: string; title: string }> = (await (await pc.get('/trpc/lavoro.list')).json()).result.data
      .jobs;
    const job = rows.find((row) => row.title === 'Frontend Developer React');
    expect(job).toBeDefined();
    if (!job) throw new Error('Missing fixture posting');
    const added = await pc.post('/trpc/notes.add', {
      data: { text: 'Annuncio eliminato', about: { source: 'lavoro-postings', id: job.key, title: job.title } },
    });
    const note = (await added.json()).result.data;

    // Trash one job
    await page.getByRole('button', { name: 'Cestino Frontend Developer React' }).click();
    await expect(page.getByRole('button', { name: 'Eliminate 1' })).toBeVisible();

    // Navigate to Eliminate
    await page.getByRole('button', { name: 'Eliminate 1' }).click();
    await expect(page.getByText('Frontend Developer React')).toBeVisible();

    // Click Elimina definitivamente
    await page.getByRole('button', { name: 'Elimina definitivamente Frontend Developer React' }).click();

    // Purge confirmation dialog opens
    const purgeDialog = page.getByRole('dialog', { name: 'Elimina definitivamente' });
    await expect(purgeDialog).toBeVisible();

    // Acceptance criterion: initial focus on Annulla
    const annullaBtn = purgeDialog.getByRole('button', { name: 'Annulla' });
    await expect(annullaBtn).toBeFocused();

    // Hold the hold-to-confirm button
    const holdBtn = purgeDialog.getByRole('button', { name: /Elimina definitivamente/ });
    const box = await holdBtn.boundingBox();
    expect(box).toBeTruthy();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(1400);
      await page.mouse.up();
    }

    // Dialog closes and job is gone from Eliminate
    await expect(purgeDialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Eliminate 0' })).toBeVisible();
    await expect(page.getByText('Frontend Developer React')).toHaveCount(0);

    await pc.post('/trpc/layout.save', {
      data: { zone: 'overview', items: [{ widget: 'notes', size: 'wide', x: 0, y: 0 }] },
    });
    await page.goto('/desk');
    const noteCard = page
      .getByRole('region', { name: 'Post-it', exact: true })
      .locator('li')
      .filter({ hasText: 'Annuncio eliminato' });
    await expect(noteCard.getByText('Frontend Developer React')).toBeVisible();
    await expect(noteCard.getByRole('link')).toHaveCount(0);
    await pc.post('/trpc/notes.remove', { data: { id: note.id } });
    await pc.post('/trpc/layout.reset', { data: { zone: 'overview' } });
    await page.goto('/desk/ricerca');

    // Another collection does NOT re-import the purged job
    await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
    await page.getByRole('button', { name: 'Da valutare 5' }).click();
    await expect(page.getByText('Frontend Developer React')).toHaveCount(0);
  });

  test('Candidature tab, counts, 21-day auto expiry, and imported job without links', async ({ page }) => {
    await page.goto('/desk/ricerca?tab=candidature&candidature=all');
    await expect(page.getByRole('heading', { level: 1, name: 'Ricerca lavoro' })).toBeVisible();

    // The phases cover the initial seed.
    await expect(page.getByRole('button', { name: 'In attesa 0' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'In colloquio 1' })).toBeVisible();
    await page.getByRole('button', { name: 'In colloquio 1' }).click();
    await expect(page.getByRole('button', { name: 'Chiuse 2' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tutte 3' })).toBeVisible();

    // 2. Active application has interview badge and does not expire
    await expect(page.getByText('Principal Engineer')).toBeVisible();
    await expect(page.getByText('Colloquio tecnico')).toBeVisible();
    await expect(page.getByText('Lead Architect')).toHaveCount(0);

    // 3. 21-day auto-expiry: old pending application shows Scaduta under Chiuse
    await page.getByRole('button', { name: 'Chiuse 2' }).click();
    await expect(page.getByText('Lead Architect')).toBeVisible();
    await expect(page.getByText('Scaduta').first()).toBeVisible();
    await expect(page.getByText('(>21 gg)')).toBeVisible();
    await expect(page.getByText('Staff Developer')).toBeVisible();
    await expect(page.getByText('Rifiutata').first()).toBeVisible();

    // 4. Imported posting without link has no "Apri sul sito originale"
    await page.getByText('Lead Architect').first().click();
    const detailDialog = page.locator('dialog[open]').first();
    await expect(detailDialog).toBeVisible();
    await expect(detailDialog.getByText('Dettagli candidatura')).toBeVisible();
    await expect(detailDialog.getByRole('link', { name: 'Apri sul sito originale' })).toHaveCount(0);
    await detailDialog.getByRole('button', { name: 'Chiudi' }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  });

  test('status filter narrows the list while segment counts remain totals', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/desk/ricerca?tab=candidature&candidature=all');
    await expect(page.getByRole('button', { name: 'Tutte 3' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Senza mail' })).toHaveCount(0);

    const pick = async (label: string) => {
      await page.getByRole('button', { name: /^Stato:/ }).click();
      await page.getByRole('option', { name: label, exact: true }).click();
    };
    // The 21-day rule still applies; badges stay at their unfiltered totals.
    await pick('Scaduta');
    await expect(page).toHaveURL(/status=expired/);
    await expect(page.getByRole('button', { name: 'Tutte 3' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'In attesa 0' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chiuse 2' })).toBeVisible();
    await page.getByRole('button', { name: 'Tutte 3' }).click();
    await expect(page.getByText('Lead Architect')).toBeVisible();
    await expect(page.getByText('Staff Developer')).toHaveCount(0);
    await expect(page.getByRole('status', { name: '1 candidature' })).toBeVisible();

    await pick('Colloqui');
    await expect(page.getByRole('button', { name: 'In colloquio 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Chiuse 2' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tutte 3' })).toBeVisible();
    await expect(page.getByText('Principal Engineer')).toBeVisible();
    await expect(page.getByText('Lead Architect')).toHaveCount(0);
    await pick('Rifiutata');
    await expect(page.getByText('Staff Developer')).toBeVisible();
    await pick('Tutti gli stati');
    await expect(page.getByRole('button', { name: 'Tutte 3' })).toBeVisible();
  });

  test('Chiuse with Colloqui includes prior interviews and excludes applications without interviews', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.route('**/trpc/*lavoro.list*', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      for (const reply of Array.isArray(body) ? body : [body]) {
        const jobs = reply.result?.data?.jobs;
        if (!Array.isArray(jobs)) continue;
        for (const job of jobs) {
          if (job.key === 'fake-rejected-key')
            job.application.interviews = [
              { id: 900, label: 'Colloquio precedente', scheduledAt: Date.now() - 86400000 },
            ];
        }
      }
      await route.fulfill({ response, json: body });
    });
    await page.goto('/desk/ricerca?tab=candidature&candidature=closed&status=interviewing');
    await expect(page.getByText('Staff Developer')).toBeVisible();
    await expect(page.getByText('Lead Architect')).toHaveCount(0);
    await expect(page.getByText('Principal Engineer')).toHaveCount(0);
    await expect(page.getByRole('status', { name: '1 candidature' })).toBeVisible();
    for (const name of ['In attesa 0', 'In colloquio 1', 'Chiuse 2', 'Tutte 3'])
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  });

  test('Statistiche lists the Possibilità rows, an old stored verdict counted through the mapping', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    // The list is rewritten in the browser: one posting per value, so the rows do not depend on other specs.
    await page.route('**/trpc/lavoro.list*', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      for (const reply of Array.isArray(body) ? body : [body]) {
        const jobs = reply.result?.data?.jobs;
        if (!Array.isArray(jobs) || jobs.length === 0) continue;
        const possibilities = ['alta', 'media', 'bassa', 'fuori'];
        reply.result.data.jobs = [
          ...jobs,
          ...possibilities.map((possibility, i) => ({
            ...jobs[0],
            key: `stats-fixture-${i}`,
            application: null,
            opinion: { verdict: possibility, possibility, codes: [], unverified: [], outdated: false },
          })),
        ];
      }
      await route.fulfill({ response, json: body });
    });
    await page.goto('/desk/ricerca?tab=statistiche');
    const table = page.getByRole('table', { name: 'Parere e esiti' });
    await expect(table).toBeVisible({ timeout: 10000 });
    for (const name of ['Possibilità alta', 'Possibilità media', 'Possibilità bassa', 'Fuori dai vincoli'])
      await expect(table.getByRole('rowheader', { name })).toBeVisible();
  });

  test('Statistiche tab shows the numbers, by source and by verdict', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('/desk/ricerca?tab=statistiche');
    const numbers = page.getByRole('term').first();
    await expect(numbers).toBeVisible({ timeout: 10000 });
    const value = (label: string) =>
      page.getByRole('term').filter({ hasText: label }).locator('xpath=following-sibling::*[1]');
    await expect(value('Inviate')).toContainText('3');
    // Staff Developer (rejected) and Principal Engineer (interview) answered; Lead Architect expired unanswered.
    await expect(value('Risposte')).toContainText('2');
    await expect(value('Colloqui')).toContainText('1');
    await expect(value('Offerte')).toContainText('0');
    await expect(value('Rifiuti')).toContainText('1');
    await expect(value('Ghosting')).toContainText('1');
    await expect(page.getByText('0 di cui dopo un colloquio')).toBeVisible();
    await expect(page.getByText(/Le mail collegate non contano come risposta/)).toBeVisible();
    await expect(page.getByRole('table', { name: 'Per fonte' })).toBeVisible();
  });

  for (const [name, data, shown] of [
    ['shows the first response under the numbers', { medianDays: 6.375, count: 8 }, 'dopo 6 giorni'],
    ['says in giornata for under a day', { medianDays: 0.4, count: 1 }, 'in giornata'],
    ['hides the row when no application has an answer', null, null],
  ] as const) {
    test(`Statistiche ${name}`, async ({ page }) => {
      // The client batches procedures: keep the real answers and swap only this one.
      await page.route('**/trpc/**lavoro.links.firstResponse**', async (route) => {
        const paths = new URL(route.request().url()).pathname.replace('/trpc/', '').split(',');
        const real = await (await route.fetch()).json();
        const batch = Array.isArray(real) ? real : [real];
        batch[paths.indexOf('lavoro.links.firstResponse')] = { result: { data } };
        await route.fulfill({ json: Array.isArray(real) ? batch : batch[0] });
      });
      await page.setViewportSize({ width: 3840, height: 2160 });
      await page.goto('/desk/ricerca?tab=statistiche');
      await expect(page.getByRole('term').first()).toBeVisible({ timeout: 10000 });
      if (shown === null) {
        await expect(page.getByText('Prima risposta')).toHaveCount(0);
        return;
      }
      await expect(page.getByText('Prima risposta')).toBeVisible();
      await expect(page.getByText(shown)).toBeVisible();
      await expect(
        page.getByText(
          data.count === 1
            ? 'su una sola candidatura con un invito o un rifiuto per mail'
            : `a metà delle ${data.count} candidature`,
        ),
      ).toBeVisible();
    });
  }

  test('Statistiche empty state uses the chart scene when no application has been sent', async ({ page }) => {
    await page.route('**/trpc/*lavoro.list*', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      for (const reply of Array.isArray(body) ? body : [body]) {
        const jobs = reply.result?.data?.jobs;
        if (!Array.isArray(jobs)) continue;
        reply.result.data.jobs = jobs.map((job: { application?: unknown }) => ({ ...job, application: null }));
      }
      await route.fulfill({ response, json: body });
    });
    await page.goto('/desk/ricerca?tab=statistiche');
    await expect(page.getByRole('heading', { name: 'Nessuna candidatura inviata' })).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-empty-scene="chart"]')).toBeVisible();
  });

  test('application panel autosave (immediate status, debounced notes) and interview with Enter', async ({ page }) => {
    await page.goto('/desk/ricerca?tab=annunci');
    const applyBtn = page.getByRole('button', { name: 'Candidato Senior Frontend Architect' });
    if (!(await applyBtn.isVisible())) {
      await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
      await expect(page.getByRole('button', { name: /Da valutare/ })).toBeVisible({ timeout: 10000 });
    }
    await expect(applyBtn).toBeVisible();
    await applyBtn.click();

    // 2. Navigate to Candidature tab
    await page.getByRole('tab', { name: 'Candidature' }).click();
    await expect(page).toHaveURL(/tab=candidature/);
    await page.getByRole('button', { name: /Tutte/ }).click();
    await expect(
      page.getByRole('tabpanel', { name: 'Candidature' }).getByRole('heading', { name: 'Senior Frontend Architect' }),
    ).toBeVisible();

    // 3. Open detail and verify ApplicationPanel
    await page
      .getByRole('tabpanel', { name: 'Candidature' })
      .getByRole('heading', { name: 'Senior Frontend Architect' })
      .click();
    const dialog = page.locator('dialog[open]').first();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Dettagli candidatura')).toBeVisible();

    // Immediate status autosave
    const statusSelect = dialog.getByRole('combobox', { name: 'Stato candidatura' });
    await expect(statusSelect).toBeVisible();
    await statusSelect.selectOption('offer');
    await expect(statusSelect).toHaveValue('offer');

    // Debounced notes autosave (type and wait > 700ms)
    const notesInput = dialog.locator('#app-notes');
    await notesInput.fill('Offerta ricevuta 50k full remote');
    await page.waitForTimeout(800);

    // Reload and check persistence
    await page.reload();
    await expect(
      page.getByRole('tabpanel', { name: 'Candidature' }).getByRole('heading', { name: 'Senior Frontend Architect' }),
    ).toBeVisible();
    await expect(page.getByText('Offerta').first()).toBeVisible();

    const reloadedDialog = page.locator('dialog[open]').first();
    await expect(reloadedDialog).toBeVisible();
    const reloadedStatus = reloadedDialog.getByRole('combobox', { name: 'Stato candidatura' });
    await expect(reloadedStatus).toHaveValue('offer');
    await expect(reloadedDialog.locator('#app-notes')).toHaveValue('Offerta ricevuta 50k full remote');

    // 4. Change status back to In attesa, then add interview with Enter
    await reloadedStatus.selectOption('pending');
    await expect(reloadedStatus).toHaveValue('pending');

    // Add interview via Enter key
    const interviewInput = reloadedDialog.getByRole('textbox', { name: 'Colloqui' });
    await interviewInput.fill('Colloquio con VP Engineering');
    await interviewInput.press('Enter');

    // Interview row appears and status badge auto-advances to Colloqui
    await expect(reloadedDialog.getByText('Colloquio con VP Engineering')).toBeVisible();
    await expect(reloadedStatus).toHaveValue('interviewing');

    // Deleting it takes the hold: a tap removes nothing, a held press does.
    const remove = reloadedDialog.getByRole('button', {
      name: 'Tieni premuto per eliminare il colloquio: Colloquio con VP Engineering',
    });
    await remove.click();
    await expect(reloadedDialog.getByText('Colloquio con VP Engineering')).toBeVisible();
    await holdButton(page, remove);
    await expect(reloadedDialog.getByText('Colloquio con VP Engineering')).toHaveCount(0);

    await reloadedDialog.getByRole('button', { name: 'Chiudi' }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
  });

  test('Timeline view and unapply with confirmation', async ({ page }) => {
    await page.goto('/desk/ricerca?tab=candidature&candidature=all');
    await expect(page.getByRole('button', { name: /In colloquio/ })).toBeVisible({ timeout: 10000 });

    // 1. Switch to Timeline view
    await page.getByRole('button', { name: 'Cronologia' }).click();
    await expect(page.getByText('candidature nel periodo')).toBeVisible();
    await expect(page.getByText('Principal Engineer')).toBeVisible();

    // Clicking timeline row opens detail
    await page.getByText('Principal Engineer').first().click();
    await expect(page).toHaveURL(/job=fake-interview-key/);
    const detailDialog = page.locator('dialog[open]').first();
    await expect(detailDialog).toBeVisible();
    await detailDialog.getByRole('button', { name: 'Chiudi' }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    // 2. Unapply with confirmation on Senior Frontend Architect
    await page.getByRole('button', { name: 'Schede' }).click();
    const architectHeading = page
      .getByRole('tabpanel', { name: 'Candidature' })
      .getByRole('heading', { name: 'Senior Frontend Architect' });
    if (!(await architectHeading.isVisible())) {
      await page.getByRole('tab', { name: 'Annunci' }).click();
      const applyBtn = page.getByRole('button', { name: 'Candidato Senior Frontend Architect' });
      if (!(await applyBtn.isVisible())) {
        await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
        await expect(page.getByRole('button', { name: /Da valutare/ })).toBeVisible({ timeout: 10000 });
      }
      await applyBtn.click();
      await page.getByRole('tab', { name: 'Candidature' }).click();
    }

    await architectHeading.click();
    const dialog = page.locator('dialog[open]').first();
    await expect(dialog).toBeVisible();

    // Click Unapply (× / Rimuovi candidatura)
    await dialog.getByRole('button', { name: 'Rimuovi candidatura' }).click();
    const confirmDialog = page.getByRole('dialog', { name: 'Rimuovi candidatura' });
    await expect(confirmDialog).toBeVisible();

    // Cancel does not remove
    await confirmDialog.getByRole('button', { name: 'Annulla' }).click();
    await expect(confirmDialog).toHaveCount(0);
    await expect(dialog.getByText('Dettagli candidatura')).toBeVisible();

    // Confirm unapply removes application
    await dialog.getByRole('button', { name: 'Rimuovi candidatura' }).click();
    await expect(confirmDialog).toBeVisible();
    await holdButton(page, confirmDialog.getByRole('button', { name: 'Tieni premuto per rimuovere la candidatura' }));
    await expect(confirmDialog).toHaveCount(0);

    // Close detail dialog
    await dialog.getByRole('button', { name: 'Chiudi' }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    // Job returned to Annunci
    await page.getByRole('tab', { name: 'Annunci' }).click();
    await expect(
      page.getByRole('tabpanel', { name: 'Annunci' }).getByRole('heading', { name: 'Senior Frontend Architect' }),
    ).toBeVisible();
  });

  test('Regole tab, create rule with live preview, blacklisting and undo', async ({ page }) => {
    await page.goto('/desk/ricerca');

    // 1. Regole tab appears after Candidature with rule count
    const regoleTab = page.getByRole('tab', { name: /Regole/ });
    await expect(regoleTab).toBeVisible();

    // 2. Open Regole tab
    await regoleTab.click();
    await expect(page.getByRole('heading', { level: 2, name: 'Nuova regola' })).toBeVisible();
    const ruleSearch = page.getByRole('textbox', { name: 'Cerca regole...' });
    await ruleSearch.fill('nessuna regola corrispondente');
    await expect(
      page.getByRole('heading', { name: 'Nessuna regola trovata per i criteri specificati.' }),
    ).toBeVisible();
    await ruleSearch.clear();

    // 3. Fill form to exclude Beta Systems
    const valueInput = page.getByRole('combobox', { name: 'Valore' });
    await valueInput.fill('nessuna azienda corrispondente');
    await expect(page.getByRole('heading', { name: 'Nessuna offerta corrisponde attualmente.' })).toBeVisible();
    await valueInput.fill('Beta');
    const suggestions = page.getByRole('listbox', { name: 'Suggerimenti' });
    await expect(suggestions.getByRole('option')).toHaveCount(1);
    await valueInput.press('ArrowDown');
    await valueInput.press('Enter');
    await expect(valueInput).toHaveValue('Beta Systems');
    await expect(suggestions).toHaveCount(0);
    await expect(page.locator('datalist')).toHaveCount(0);

    // Live preview shows matching count and preview card
    await expect(page.getByText(/Anteprima offerte corrispondenti/)).toBeVisible();
    const previewBtn = page.getByRole('button', { name: /Web Developer Junior/ });
    await expect(previewBtn).toBeVisible();

    // Clicking preview opens detail
    await previewBtn.click();
    const detailDialog = page.locator('dialog[open]').first();
    await expect(detailDialog).toBeVisible();
    await expect(detailDialog.getByText('Web Developer Junior')).toBeVisible();
    await detailDialog.getByRole('button', { name: 'Chiudi' }).click();

    // Save rule
    await page.getByRole('button', { name: 'Salva regola' }).click();
    await expect(page.getByText('Regola creata')).toBeVisible();

    // Switch back to Annunci tab: Beta Systems is now in Escluse
    await page.getByRole('tab', { name: 'Annunci' }).click();
    await page.getByRole('button', { name: /Escluse/ }).click();
    await expect(page.getByText('Web Developer Junior')).toBeVisible();

    // Undo from toast restores it
    const undoBtn = page.getByRole('button', { name: 'Annulla' });
    if (await undoBtn.isVisible()) {
      await undoBtn.click();
      await page.getByRole('button', { name: /Da valutare/ }).click();
      await expect(page.getByText('Web Developer Junior')).toBeVisible();
    }
  });

  test('Vedi button filters Escluse segment by rule ID', async ({ page }) => {
    await page.goto('/desk/ricerca');

    // Go to Regole tab
    await page.getByRole('tab', { name: /Regole/ }).click();

    // Click Vedi on Zeta Mobile rule
    const vediBtn = page.getByRole('button', { name: /Vedi/ }).first();
    await expect(vediBtn).toBeVisible();
    await vediBtn.click();

    // Navigates to Escluse filtered by that rule
    await expect(page).toHaveURL(/segment=blacklisted/);
    await expect(page).toHaveURL(/rule=/);
    await expect(page.getByText('React Native Developer')).toBeVisible();
    // Negative check: Acme Corp not in this filtered list
    await expect(page.getByText('Frontend Developer React')).toHaveCount(0);

    // Filter chip is visible
    const ruleChip = page.getByRole('button', { name: /Rimuovi Regola/ });
    await expect(ruleChip).toBeVisible();
    await ruleChip.click();
    await expect(page).not.toHaveURL(/rule=/);
  });

  test('a long rule value and note wrap in full at 1280 and 3840 and Modifica and Elimina carry their names', async ({
    page,
  }) => {
    const long = `${'Very long company name '.repeat(4)}s.r.l.`.slice(0, 80).padEnd(80, 'x');
    expect(long).toHaveLength(80);
    await page.goto('/desk/ricerca');
    await page.getByRole('tab', { name: /Regole/ }).click();
    await page.getByLabel('Valore').fill(long);
    await page.getByLabel('Nota (opzionale)').fill(`Note for ${long}`);
    await page.getByRole('button', { name: 'Salva regola' }).click();
    const edit = page.getByRole('button', { name: `Modifica regola ${long}` });
    const remove = page.getByRole('button', { name: `Elimina regola ${long}` });
    await expect(edit).toHaveText('Modifica');
    await expect(remove).toHaveText('Elimina');
    for (const width of [1280, 3840]) {
      await page.setViewportSize({ width, height: 2160 });
      const value = page.getByText(long, { exact: true });
      await expect(value).toBeVisible();
      const note = page.getByText(`Note for ${long} · `);
      await expect(note).toBeVisible();
      for (const text of [value, note]) {
        expect(await text.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      }
    }
  });

  test('the segment, view switch and card action use Italian names', async ({ page }) => {
    await page.goto('/desk/ricerca');
    await expect(page.getByRole('button', { name: 'Escluse 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Candidato / }).first()).toBeVisible();
    await page.getByRole('tab', { name: 'Candidature' }).click();
    await expect(page.getByRole('button', { name: 'Schede' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cronologia' })).toBeVisible();
    for (const old of ['Blacklisted', 'Card', 'Apply', 'Timeline']) {
      await expect(page.getByText(old, { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: new RegExp(`^${old}\\b`) })).toHaveCount(0);
    }
  });

  test('Statistiche names sources and opinions, and the posting title sits one step above the company line', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.goto('/desk/ricerca?tab=statistiche');
    await expect(page.getByRole('term').first()).toBeVisible({ timeout: 10000 });
    for (const name of ["Sito dell'azienda", 'Agenzia', 'LinkedIn']) {
      await expect(page.getByRole('rowheader', { name })).toBeVisible();
    }
    for (const raw of ['sito', 'agenzia', 'linkedin']) {
      await expect(page.getByRole('rowheader', { name: raw, exact: true })).toHaveCount(0);
    }
    await page.goto('/desk/ricerca');
    await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
    await expect(page.locator('[data-posting-key]').first()).toBeVisible({ timeout: 10000 });
    const rem = await page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).fontSize));
    const card = page.locator('[data-posting-key]').first();
    await expect(card.getByRole('heading')).toHaveCSS('font-size', `${rem}px`);
    await expect(card.locator('span.text-caption').filter({ hasText: '•' })).toHaveCSS('font-size', `${rem * 0.75}px`);
  });

  test('disable and delete rule with confirmation and undo', async ({ page }) => {
    await page.goto('/desk/ricerca');
    await page.getByRole('tab', { name: /Regole/ }).click();

    // Create a new rule for Delta Solutions
    await page.getByLabel('Valore').fill('Delta Solutions');
    await page.getByRole('button', { name: 'Salva regola' }).click();
    await expect(page.getByText('Regola creata')).toBeVisible();

    // Find the switch for Delta Solutions
    const deltaSwitch = page.getByRole('switch', { name: /Delta Solutions/ });
    await expect(deltaSwitch).toBeVisible();
    await expect(deltaSwitch).toHaveAttribute('aria-checked', 'true');

    // Toggle switch off
    await deltaSwitch.click();
    await expect(deltaSwitch).toHaveAttribute('aria-checked', 'false');

    // Deleting rule asks for confirmation
    const deleteBtn = page.getByRole('button', { name: /Elimina regola Delta Solutions/ });
    await deleteBtn.click();
    const confirmModal = page.locator('dialog[open]').first();
    await expect(confirmModal.getByText(/Sei sicuro di voler eliminare la regola/)).toBeVisible();

    // Confirm deletion
    await holdButton(page, confirmModal.getByRole('button', { name: 'Tieni premuto per eliminare la regola' }));
    await expect(page.getByText('Regola eliminata')).toBeVisible();

    // Undo deletion restores rule
    const undoBtn = page.getByRole('button', { name: 'Annulla' });
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();
    await expect(page.getByRole('switch', { name: /Delta Solutions/ })).toBeVisible();
  });

  test('detail Blacklist menu and Includi di nuovo', async ({ page }) => {
    await page.goto('/desk/ricerca');

    // Open detail for Frontend Engineer Vue
    await page.getByText('Frontend Engineer Vue').click();
    const dialog = page.locator('dialog[open]').first();
    await expect(dialog).toBeVisible();

    // Open Blacklist menu
    const blacklistMenuBtn = dialog.getByRole('button', { name: 'Blacklist' });
    await expect(blacklistMenuBtn).toBeVisible();
    await blacklistMenuBtn.click();

    // Menu options visible
    await expect(dialog.getByRole('button', { name: "Escludi l'azienda", exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Escludi questa offerta' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Regola personalizzata' })).toBeVisible();

    // Click Escludi questa offerta
    await page.getByRole('button', { name: 'Escludi questa offerta' }).click();
    await expect(page.getByText(/Offerta esclusa/)).toBeVisible();

    // Close detail dialog
    await dialog.getByRole('button', { name: 'Chiudi' }).click();

    // Post leaves Da valutare and enters Escluse
    await page.getByRole('button', { name: /Escluse/ }).click();
    await expect(page.getByText('Frontend Engineer Vue')).toBeVisible();

    // Open detail from Escluse
    await page.getByText('Frontend Engineer Vue').click();
    const blDialog = page.locator('dialog[open]').first();

    // "Includi di nuovo" button appears
    const includeAgainBtn = blDialog.getByRole('button', { name: 'Includi di nuovo' });
    await expect(includeAgainBtn).toBeVisible();
    await includeAgainBtn.click();
    await expect(page.getByText('Offerta ripristinata in Da valutare')).toBeVisible();

    await blDialog.getByRole('button', { name: 'Chiudi' }).click();

    // Reload page: stays in Da valutare
    await page.reload();
    await page.getByRole('button', { name: /Da valutare/ }).click();
    await expect(page.getByText('Frontend Engineer Vue')).toBeVisible();
  });

  test('import from link and duplicate conflict handling', async ({ page }) => {
    await page.goto('/desk/ricerca');

    // Open Import dialog
    await page.getByRole('button', { name: 'Altre azioni di raccolta' }).click();
    await page.getByRole('menuitem', { name: 'Importa da link' }).click();

    const importDialog = page.locator('dialog[open]').first();
    await expect(importDialog.getByText('Importa offerta da link')).toBeVisible();

    // Fill fixture URL and click Read
    const urlInput = importDialog.getByLabel('URL offerta');
    await urlInput.fill('https://example.com/fixture-job');
    await importDialog.getByRole('button', { name: 'Leggi pagina' }).click();

    // Form fields are populated
    const titleInput = importDialog.getByLabel('Titolo');
    await expect(titleInput).toHaveValue('Fixture React Dev');
    await expect(importDialog.getByLabel('Azienda')).toHaveValue('TechCorp');

    // Fields remain editable
    await titleInput.fill('Custom React Dev');

    // Save imported posting
    await importDialog.getByRole('button', { name: 'Salva offerta' }).click();
    await expect(page.getByText('Offerta importata con successo')).toBeVisible();

    // Appears in Da valutare
    await expect(page.getByText('Custom React Dev')).toBeVisible();

    // Duplicate import attempt
    await page.getByRole('button', { name: 'Altre azioni di raccolta' }).click();
    await page.getByRole('menuitem', { name: 'Importa da link' }).click();
    const dupDialog = page.locator('dialog[open]').first();
    await dupDialog.getByLabel('URL offerta').fill('https://example.com/fixture-job');
    await dupDialog.getByRole('button', { name: 'Leggi pagina' }).click();
    await expect(dupDialog.getByLabel('Titolo')).toHaveValue('Fixture React Dev');
    await dupDialog.getByRole('button', { name: 'Salva offerta' }).click();

    // Shows conflict and link to existing job
    await expect(dupDialog.getByText('Questa offerta è già presente:')).toBeVisible();
    const openExistingBtn = dupDialog.getByRole('button', { name: 'Apri offerta esistente' });
    await expect(openExistingBtn).toBeVisible();

    // Clicking it navigates to existing job detail
    await openExistingBtn.click();
    const detailDialog = page.locator('dialog[open]').first();
    await expect(detailDialog.getByText('Custom React Dev')).toBeVisible();
    await detailDialog.getByRole('button', { name: 'Chiudi' }).click();
  });

  test('edit posting from detail persists title and score after reload', async ({ page }) => {
    await page.goto('/desk/ricerca?sort=score');

    // Open detail of an existing job
    await page.getByText('Fullstack Developer Web').click();
    const detailDialog = page.locator('dialog[open]').first();
    await expect(detailDialog).toBeVisible();

    // Click Modifica
    await detailDialog.getByRole('button', { name: 'Modifica' }).click();

    // Edit dialog appears
    const editDialog = page.locator('dialog[open]').nth(1);
    await expect(editDialog.getByText('Modifica offerta')).toBeVisible();

    // Change title and score
    const titleInput = editDialog.getByLabel('Titolo');
    await titleInput.fill('Senior Fullstack Web Engineer');
    const scoreInput = editDialog.getByLabel('Punteggio totale');
    await scoreInput.fill('42');

    // Save changes
    await editDialog.getByRole('button', { name: 'Salva modifiche' }).click();
    await expect(page.getByText('Offerta modificata con successo')).toBeVisible();

    // Detail dialog reflects updated values
    await expect(detailDialog.getByText('Senior Fullstack Web Engineer')).toBeVisible();
    await expect(detailDialog.getByText('42', { exact: true })).toBeVisible();

    // Reload page: same job key and values persist
    await page.reload();
    const reloadedDialog = page.locator('dialog[open]').first();
    await expect(reloadedDialog.getByText('Senior Fullstack Web Engineer')).toBeVisible();
    await expect(reloadedDialog.getByText('42', { exact: true })).toBeVisible();
    await reloadedDialog.getByRole('button', { name: 'Chiudi' }).click();
  });

  test('already applied at the same company: badge and detail line on the other posting, nothing duplicated', async ({
    page,
    pc,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const card = (title: string) =>
      page.locator('div.group').filter({ has: page.getByRole('heading', { level: 4, name: title }) });
    const listResponseSchema = z.object({
      result: z.object({ data: z.object({ jobs: z.array(z.object({ key: z.string(), title: z.string() })) }) }),
    });
    const keysOf = async () =>
      listResponseSchema
        .parse(await (await pc.get('/trpc/lavoro.list')).json())
        .result.data.jobs.filter((job) => job.title === 'Frontend Engineer Vue');
    await page.goto('/desk/ricerca?sort=score');
    await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible();
    await expect(page.getByText('Già candidato')).toHaveCount(0);

    try {
      await page.getByRole('button', { name: 'Candidato Frontend Engineer Vue' }).click();
      await expect(page.getByRole('button', { name: 'Da valutare 5' })).toBeVisible();

      // The other Gamma Tech posting carries the badge, and only it does.
      const second = card('Senior Frontend Architect');
      await expect(second.getByText('Già candidato')).toBeVisible();
      await expect(page.getByText('Già candidato')).toHaveCount(1);
      // The badge text is animated in letters that catch the pointer, so hover its focusable wrapper.
      await second.locator('[tabindex="0"]', { hasText: 'Già candidato' }).hover();
      await expect(page.getByRole('tooltip')).toContainText('Frontend Engineer Vue');
      await expect(page.getByRole('tooltip')).toContainText(/\d{1,2} \p{L}+\.?, in attesa/u);

      // The detail names the same earlier application.
      await second.getByRole('heading', { level: 4 }).click();
      const detail = page.locator('dialog[open]').first();
      await expect(detail.getByText('Già candidato')).toBeVisible();
      await expect(detail.getByText(/Frontend Engineer Vue, \d{1,2} \p{L}+\.?, in attesa/u)).toBeVisible();
      await detail.getByRole('button', { name: 'Chiudi' }).click();
      await expect(detail).toBeHidden();

      // Applying to the second too leaves each application once in Candidature.
      await page.getByRole('button', { name: 'Candidato Senior Frontend Architect' }).click();
      await expect(page.getByRole('button', { name: 'Da valutare 4' })).toBeVisible();
      await page.getByRole('tab', { name: 'Candidature' }).click();
      const panel = page.getByRole('tabpanel', { name: 'Candidature' });
      await expect(panel.getByRole('heading', { name: 'Frontend Engineer Vue' })).toHaveCount(1);
      await expect(panel.getByRole('heading', { name: 'Senior Frontend Architect' })).toHaveCount(1);

      // Undoing the second leaves the first untouched and the badge returns on the second card.
      await page.getByRole('tab', { name: 'Annunci' }).click();
      await page.locator('[data-toast]').getByRole('button', { name: 'Annulla' }).click();
      await expect(card('Senior Frontend Architect').getByText('Già candidato')).toBeVisible();
      await page.getByRole('tab', { name: 'Candidature' }).click();
      await expect(panel.getByRole('heading', { name: 'Frontend Engineer Vue' })).toHaveCount(1);
    } finally {
      for (const job of await keysOf()) {
        await pc.post('/trpc/lavoro.setFlag', {
          data: { keys: [job.key], flag: 'applied', value: false, confirmed: true },
        });
      }
    }
  });
});

test('mail suggestions, explicit links, reading and waiting segments', async ({ page, pc }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  let releaseThreads = () => {};
  let releaseRead = () => {};
  const threadsPending = new Promise<void>((resolve) => {
    releaseThreads = resolve;
  });
  const readPending = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const post = (name: string, data: object) => pc.post(`/trpc/lavoro.${name}`, { data });
  const appliedAt = Date.UTC(2026, 10, 8, 12);
  const original = (await (await pc.get('/trpc/lavoro.list')).json()).result.data.jobs;
  const originalInterview = original.find((job: { key: string }) => job.key === 'fake-interview-key').application;
  const originalRejected = original.find((job: { key: string }) => job.key === 'fake-rejected-key').application;
  await post('edit', { key: 'fake-interview-key', job: { company: 'Offerta' } });
  await post('setApplication', { key: 'fake-interview-key', appliedAt, status: 'interviewing', closedAt: null });
  await post('setApplication', { key: 'fake-rejected-key', appliedAt, status: 'pending', closedAt: null });
  try {
    await page.clock.setFixedTime(new Date('2026-11-16T12:00:00Z'));
    await page.route('**/trpc/mail.threads*', async (route) => {
      await threadsPending;
      await route.fulfill({
        json: [
          {
            result: {
              data: {
                threads: [
                  {
                    account: 'work',
                    messageId: 'offer@example.org',
                    thread: {
                      messageId: 'offer@example.org',
                      waiting: true,
                      messages: [
                        {
                          mailbox: 'inbox',
                          id: '310',
                          messageId: 'offer@example.org',
                          inReplyTo: [],
                          subject: 'Offerta di colloquio',
                          date: '2026-11-07T09:00:00Z',
                        },
                        {
                          mailbox: 'sent',
                          id: '43',
                          messageId: 'followup@example.org',
                          inReplyTo: ['offer@example.org'],
                          subject: 'Re: Offerta di colloquio',
                          date: '2026-11-07T14:00:00Z',
                        },
                      ],
                    },
                  },
                ],
                truncated: false,
                after: '2026-09-09',
              },
            },
          },
        ],
      });
    });
    await page.route('**/trpc/mail.read*', async (route) => {
      await readPending;
      await route.continue();
    });
    await page.goto('/desk/ricerca?tab=candidature&candidature=all');
    await page.getByRole('heading', { name: 'Principal Engineer' }).click();
    const detail = page.locator('dialog[open]').first();
    await detail.getByRole('button', { name: 'Collega mail' }).click();
    const connect = page.getByRole('dialog', { name: 'Collega mail' });
    await expect(connect.getByRole('button', { name: /Offerta di colloquio/ }).first()).toBeVisible();
    const before = await pc.get(
      `/trpc/lavoro.links.list?input=${encodeURIComponent(JSON.stringify({ key: 'fake-interview-key' }))}`,
    );
    expect((await before.json()).result.data).toHaveLength(0);
    const calls: string[][] = (await (await pc.get('/m/mail/fake-calls')).json()).calls;
    for (const mailbox of ['INBOX', 'sent'])
      for (const field of ['from', 'subject']) {
        expect(
          calls.some(
            (args) =>
              args.includes('search') &&
              args.includes(mailbox) &&
              args.includes(field) &&
              args.includes('"Offerta"') &&
              args.includes('2026-11-05'),
          ),
        ).toBeTruthy();
      }
    await connect.getByRole('searchbox', { name: 'Cerca mail' }).fill('Carla');
    await expect(connect.getByRole('button', { name: /Re: Domanda sul ruolo/ })).toBeVisible();
    await connect.getByRole('searchbox', { name: 'Cerca mail' }).fill('');
    await expect(connect.getByRole('button', { name: /Offerta di colloquio/ }).first()).toBeVisible();
    await connect
      .getByRole('button', { name: /Offerta di colloquio/ })
      .first()
      .click();
    await expect(connect).toBeHidden();
    const loadingThreads = detail.getByRole('status', { name: 'Caricamento delle conversazioni' });
    await expect(loadingThreads).toBeVisible();
    const threadsBox = await loadingThreads.boundingBox();
    releaseThreads();
    await expect(detail.getByText('Ultimo messaggio inviato')).toBeVisible();
    const conversations = await detail.getByRole('list', { name: 'Conversazioni' }).boundingBox();
    if (!threadsBox || !conversations) throw new Error('Mail conversations must be laid out');
    expect(Math.abs(threadsBox.y - conversations.y)).toBeLessThanOrEqual(8);
    expect(Math.abs(threadsBox.x - conversations.x)).toBeLessThanOrEqual(8);
    expect(Math.abs(threadsBox.width - conversations.width)).toBeLessThanOrEqual(8);
    await detail.getByRole('button', { name: 'Leggi: Offerta di colloquio' }).click();
    const loadingRead = detail.getByRole('status', { name: 'Caricamento delle conversazioni' });
    await expect(loadingRead).toBeVisible();
    const readBox = await loadingRead.boundingBox();
    releaseRead();
    await expect(detail.getByText('Buongiorno, vorremmo proporle un colloquio.', { exact: false })).toBeVisible();
    const messageBox = await detail
      .getByText('Buongiorno, vorremmo proporle un colloquio.', { exact: false })
      .boundingBox();
    if (!readBox || !messageBox) throw new Error('Mail message must be laid out');
    expect(Math.abs(readBox.y - messageBox.y)).toBeLessThanOrEqual(8);
    expect(Math.abs(readBox.x - messageBox.x)).toBeLessThanOrEqual(8);
    expect(Math.abs(readBox.width - messageBox.width)).toBeLessThanOrEqual(8);
    const afterRead: string[][] = (await (await pc.get('/m/mail/fake-calls')).json()).calls;
    expect(afterRead.some((args) => args.includes('read') && args.includes('310'))).toBeTruthy();
    expect(afterRead.flat()).not.toContain('--seen');
    await detail.getByRole('button', { name: 'Chiudi' }).click();
    await expect(detail).not.toBeVisible();
    await expect(
      page.getByRole('tabpanel', { name: 'Candidature' }).getByRole('heading', { name: 'Principal Engineer' }),
    ).toBeVisible();
  } finally {
    await post('links.remove', {
      key: 'fake-interview-key',
      account: 'work',
      messageId: 'offer@example.org',
      confirmed: true,
    });
    await post('edit', { key: 'fake-interview-key', job: { company: 'Next Wave' } });
    await post('setApplication', {
      key: 'fake-interview-key',
      appliedAt: originalInterview.appliedAt,
      status: originalInterview.status,
      closedAt: originalInterview.closedAt,
    });
    await post('setApplication', {
      key: 'fake-rejected-key',
      appliedAt: originalRejected.appliedAt,
      status: originalRejected.status,
      closedAt: originalRejected.closedAt,
    });
  }
});

test('mail disabled hides segments and explains availability in the panel', async ({ page, pc }) => {
  test.setTimeout(60_000);
  const toggle = (enabled: boolean) => pc.post('/trpc/settings.save', { data: { module: 'mail', enabled } });
  await toggle(false);
  try {
    await expect
      .poll(async () => (await pc.get('/trpc/mail.accounts').catch(() => null))?.status(), { timeout: 30_000 })
      .toBe(404);
    await page.goto('/desk/ricerca?tab=candidature&candidature=all');
    await expect(page.getByRole('button', { name: /In colloquio/ })).toBeVisible();
    await page.getByRole('heading', { name: 'Principal Engineer' }).click();
    await expect(page.getByText(/Impostazioni -> Catalogo/)).toBeVisible();
  } finally {
    await toggle(true);
    await expect
      .poll(async () => (await pc.get('/trpc/mail.accounts').catch(() => null))?.status(), { timeout: 30_000 })
      .toBe(200);
  }
});

test('an absent mail configuration hides mail segments and explains the panel state', async ({ page }) => {
  const app = buildServer({ dbPath: ':memory:', config: emptyConfig, deps: { run: createFakeDesktop() } });
  try {
    const missing = await app.inject('/trpc/mail.accounts');
    expect(missing.statusCode).toBe(404);
    await page.route('**/trpc/mail.accounts*', (route) =>
      route.fulfill({ status: missing.statusCode, body: missing.body, contentType: 'application/json' }),
    );
    await page.goto('/desk/ricerca?tab=candidature&candidature=all');
    await expect(page.getByRole('button', { name: /In colloquio/ })).toBeVisible();
    await page.getByRole('heading', { name: 'Principal Engineer' }).click();
    await expect(page.getByText(/Impostazioni -> Catalogo/)).toBeVisible();
  } finally {
    await app.close();
  }
});

test('a thread failure leaves applications available and reports an unknown state', async ({ page, pc }) => {
  const link = { key: 'fake-interview-key', account: 'work', messageId: 'offer@example.org' };
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await pc.post('/trpc/lavoro.links.add', { data: link });
  try {
    await page.route('**/trpc/mail.threads*', async (route) => {
      await pending;
      await route.abort();
    });
    await page.goto('/desk/ricerca?tab=candidature&candidature=all');
    await expect(page.getByRole('heading', { name: 'Principal Engineer' })).toBeVisible();
    release();
    await page.getByRole('heading', { name: 'Principal Engineer' }).click();
    await holdButton(page, page.getByRole('button', { name: 'Tieni premuto per scollegare la mail' }));
    await expect(page.getByRole('heading', { name: 'Nessuna mail collegata.' })).toBeVisible();
  } finally {
    release();
    await pc.post('/trpc/lavoro.links.remove', { data: { ...link, confirmed: true } });
  }
});

test('the postings list scrolls while its controls stay fixed', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/desk/ricerca');
  await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: 'Opzioni vista' }).click();
  await page.getByRole('button', { name: /^Colonne:/ }).click();
  await page.getByRole('option', { name: '1', exact: true }).click();
  await page.keyboard.press('Escape');
  const list = page.locator('[data-page-scroller]');
  const search = page.getByPlaceholder(/Cerca annunci/);
  await search.focus();
  await expect(search).toBeFocused();
  await list.hover();
  await expect
    .poll(() =>
      page
        .locator('main')
        .evaluate(
          (element) =>
            element
              .getAnimations({ subtree: true })
              .filter(
                (animation) =>
                  animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime),
              ).length,
        ),
    )
    .toBe(0);
  const positions = () =>
    page
      .locator('main')
      .evaluate((main) =>
        [
          main.querySelector('h1'),
          main.querySelector('[role="tablist"]'),
          main.querySelector('input[aria-label="Cerca annunci"]'),
          [...main.querySelectorAll('button')].find((button) => button.textContent?.includes('Da valutare')),
        ].map((element) => element?.getBoundingClientRect().y),
      );
  const before = await positions();
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await positions()).toEqual(before);
  // The tab bar is the first row inside the one surface, as on every page (step 47c).
  await expect(page.locator('[data-page-surface]')).toHaveCount(1);
  const bar = await page.getByRole('tablist').boundingBox();
  const surfaceBox = await page.locator('[data-page-surface]').boundingBox();
  expect(bar && surfaceBox && bar.y > surfaceBox.y && bar.y + bar.height < surfaceBox.y + surfaceBox.height).toBe(true);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole('button', { name: 'Ordina: Possibilità, poi interesse' }).click();
  await page.getByRole('option', { name: 'Interesse', exact: true }).click();
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);
  await list.evaluate((element) => element.scrollTo(0, 500));
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Archiviate 0' }).click();
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(0);
});

test('statistics scrolls the surface while the tab bar stays fixed', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 400 });
  await page.goto('/desk/ricerca?tab=statistiche');
  const tab = page.getByRole('tab', { name: 'Statistiche' });
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const before = await tab.boundingBox();
  const surface = page.locator('[data-page-scroller]');
  await expect
    .poll(() => surface.evaluate((element) => (element.scrollTo(0, 500), element.scrollTop)))
    .toBeGreaterThan(0);
  expect((await tab.boundingBox())?.y).toBe(before?.y);
  expect(await page.getByRole('tabpanel').evaluate((element) => element.scrollTop)).toBe(0);
});

test('closing a detail returns to the last posting shown', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 750 });
  await page.goto('/desk/ricerca?sort=score');
  await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible({ timeout: 10000 });
  const list = page.locator('[data-page-scroller]');
  const cards = list.getByRole('heading', { level: 4 });
  await expect(cards).toHaveCount(6);
  const lastTitle = await cards.last().textContent();
  await cards.first().click();
  const dialog = page.locator('dialog[open]').first();
  await expect(dialog).toBeVisible();
  for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
  await expect(dialog.getByText('6 di 6')).toBeVisible();
  await dialog.getByRole('button', { name: 'Chiudi' }).click();
  await expect(dialog).toHaveCount(0);
  const last = cards.filter({ hasText: lastTitle ?? '' });
  await expect
    .poll(async () =>
      last.evaluate((element) => {
        const listElement = element.closest('[data-page-scroller]');
        if (!listElement) return false;
        const card = element.getBoundingClientRect();
        const bounds = listElement.getBoundingClientRect();
        return card.top >= bounds.top && card.bottom <= bounds.bottom;
      }),
    )
    .toBe(true);
});

test('applications and rules keep their controls fixed while their lists scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 750 });
  await page.goto('/desk/ricerca?sort=score');
  await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Da valutare 6' })).toBeVisible({ timeout: 10000 });
  for (let i = 0; i < 6; i++) {
    const button = page.getByRole('button', { name: /^Candidato / }).first();
    await button.click();
    await expect(page.getByRole('button', { name: `Da valutare ${5 - i}` })).toBeVisible();
  }
  await page.getByRole('tab', { name: 'Candidature' }).click();
  const applications = page.locator('[data-page-scroller]');
  const search = page.getByPlaceholder('Cerca per titolo, azienda, note...');
  await search.focus();
  await expect(search).toBeFocused();
  const before = await search.boundingBox();
  await applications.hover();
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => applications.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect((await search.boundingBox())?.y).toBe(before?.y);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.getByRole('tab', { name: /Regole/ }).click();
  const value = page.getByLabel('Valore');
  for (let i = 0; i < 10; i++) {
    await value.fill(`Example rule ${i}`);
    await page.getByRole('button', { name: 'Salva regola' }).click();
    await expect(page.getByRole('button', { name: `Modifica regola Example rule ${i}` })).toBeVisible();
  }
  const rules = page.locator('[data-page-scroller]');
  const filter = page.getByPlaceholder('Cerca regole...');
  await filter.focus();
  await expect(filter).toBeFocused();
  const top = await filter.boundingBox();
  await rules.hover();
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => rules.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect((await filter.boundingBox())?.y).toBe(top?.y);
  await page.getByRole('button', { name: 'Attive', exact: true }).click();
  await expect.poll(() => rules.evaluate((element) => element.scrollTop)).toBe(0);
  await rules.hover();
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => rules.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Modifica regola Example rule 9' }).click();
  await expect.poll(() => rules.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('mail section deduplicates linked conversations but keeps a different thread', async ({ page, pc }) => {
  const links = ['a@example.com', 'b@example.com', 'c@example.com'].map((messageId) => ({
    key: 'fake-interview-key',
    account: 'work',
    messageId,
  }));
  for (const link of links) await pc.post('/trpc/lavoro.links.add', { data: link });
  try {
    await page.route('**/trpc/mail.threads*', (route) =>
      route.fulfill({
        json: [
          {
            result: {
              data: {
                threads: links.map((link) => ({
                  account: link.account,
                  messageId: link.messageId,
                  thread: {
                    messageId: link.messageId,
                    key: link.messageId === 'c@example.com' ? 'c@example.com' : 'a@example.com',
                    waiting: false,
                    messages: [
                      {
                        mailbox: 'inbox',
                        id: link.messageId === 'c@example.com' ? '2' : '1',
                        messageId: link.messageId,
                        inReplyTo: [],
                        subject: link.messageId === 'c@example.com' ? 'Different topic' : 'Project meeting',
                        date: null,
                        counterpart: 'person@example.com',
                      },
                    ],
                  },
                })),
                truncated: false,
                after: '2026-09-09',
              },
            },
          },
        ],
      }),
    );
    await page.goto('/desk/ricerca?tab=candidature&candidature=all');
    await page.getByRole('heading', { name: 'Principal Engineer' }).click();
    const section = page.getByRole('region', { name: 'Mail' });
    await expect(section.getByRole('list', { name: 'Conversazioni' }).getByRole('listitem')).toHaveCount(2);
    await expect(section.getByRole('button', { name: 'Tieni premuto per scollegare la mail' })).toHaveCount(3);
    await expect(section.getByText('Project meeting', { exact: true })).toHaveCount(1);
    await expect(section.getByText('Different topic', { exact: true })).toHaveCount(1);
  } finally {
    for (const link of links) await pc.post('/trpc/lavoro.links.remove', { data: { ...link, confirmed: true } });
  }
});

test('mail proposals from the local model: a suggested link then its interview, confirmed with one tap each', async ({
  page,
  pc,
}) => {
  const link = { key: 'fake-interview-key', account: 'work', messageId: 'offer@example.org' };
  await page.goto('/desk/ricerca?tab=candidature&candidature=all');
  try {
    await page.getByRole('button', { name: 'Controlla posta' }).click();
    const confirm = page.getByRole('button', { name: 'Conferma: Offerta di colloquio' });
    await expect(confirm).toBeVisible();
    await expect(page.getByText(/sembra riguardare Next Wave/)).toBeVisible();
    // Nothing is linked before the tap.
    const before = await (
      await pc.get('/trpc/lavoro.links.list?input=' + encodeURIComponent(JSON.stringify({ key: link.key })))
    ).json();
    expect(before.result.data).toEqual([]);

    await confirm.click();
    const interviewRow = page
      .getByRole('listitem')
      .filter({ hasText: 'Colloquio, Sede esempio https://meet.example.test/abc il' });
    await expect(interviewRow).toBeVisible();
    await expect(interviewRow).toContainText('da recruiter@example.org');
    await expect(interviewRow.locator('a')).toHaveCount(0);
    await page.getByRole('button', { name: 'Conferma: Offerta di colloquio' }).click();
    // With nothing left to confirm only the button stays: no "nothing to show" line (owner, 2026-11-16).
    await expect(page.getByRole('button', { name: /^Conferma:/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Controlla posta' })).toBeVisible();
    await expect(page.getByText('Nessuna proposta dalla posta.')).toHaveCount(0);

    await page.getByRole('heading', { name: 'Principal Engineer' }).click();
    await expect(
      page.getByText('Colloquio, Sede esempio https://meet.example.test/abc', { exact: true }),
    ).toBeVisible();
  } finally {
    await pc.post('/trpc/lavoro.links.remove', { data: { ...link, confirmed: true } });
    const list = await (await pc.get('/trpc/lavoro.list')).json();
    const row = list.result.data.jobs.find((job: { key: string }) => job.key === link.key);
    for (const interview of row.application.interviews)
      if (interview.label === 'Colloquio, Sede esempio https://meet.example.test/abc')
        await pc.post('/trpc/lavoro.deleteInterview', { data: { id: interview.id, confirmed: true } });
  }
});

test('Oggi lists what the mail asks as Lavoro rows, with its deadline, and a dismissed item is hidden', async ({
  page,
  pc,
}) => {
  // The mail is read once per database: whichever test ran first did it, and this one only needs its result.
  await pc.post('/trpc/lavoro.mailCheck.run', { data: {} });
  await expect
    .poll(async () => (await (await pc.get('/trpc/lavoro.mailCheck.todos')).json()).result.data.length)
    .toBeGreaterThan(0);
  // Esteso shows six lines a day, so the todo is not cut behind "e altre N" by the other modules' lines.
  await pc.post('/trpc/layout.save', {
    data: { zone: 'overview', items: [{ widget: 'today', size: 'full', x: 0, y: 0 }] },
  });
  await page.goto('/desk');
  const todo = page.getByRole('list', { name: 'Righe di oggi' });
  const todoRow = todo
    .getByRole('listitem')
    .filter({ hasText: 'Rispondere con la disponibilità su https://calendly.example.test/slot' });
  await expect(todoRow).toBeVisible();
  await expect(todoRow).toContainText('da carla@example.org, entro 10 gen');
  await expect(todoRow.locator('a')).toHaveCount(0);
  await todo
    .getByRole('button', { name: 'Nascondi: Rispondere con la disponibilità su https://calendly.example.test/slot' })
    .click();
  await expect(todo.getByText('Rispondere con la disponibilità su https://calendly.example.test/slot')).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Rispondere con la disponibilità su https://calendly.example.test/slot')).toHaveCount(0);
  await pc.post('/trpc/layout.reset', { data: { zone: 'overview' } });
  await expect(pc.get('/trpc/lavoro.mailCheck.todos').then((response) => response.json())).resolves.toMatchObject({
    result: { data: [] },
  });
});

test.describe('in a zone east of UTC', () => {
  // Pinned so the check bites on any machine: 23:30 UTC on the 16th is 00:30 on the 17th in Rome, the 16th in UTC.
  test.use({ timezoneId: 'Europe/Rome' });
  test('the Timeline tooltip dates an interview just after midnight on its local day', async ({ page, pc }) => {
    await page.clock.install({ time: Date.UTC(2026, 10, 15, 8, 0) });
    const added = await pc.post('/trpc/lavoro.addInterview', {
      data: {
        key: 'fake-interview-key',
        scheduledAt: Date.UTC(2026, 10, 16, 23, 30),
        label: 'Colloquio mezzanotte',
      },
    });
    const { id } = (await added.json()).result.data;
    try {
      await page.goto('/desk/ricerca?tab=candidature&candidature=all');
      await page.getByRole('button', { name: 'Cronologia' }).click();
      await expect(page.getByRole('button', { name: 'Colloquio mezzanotte (2026-11-17)' })).toBeVisible();
    } finally {
      await pc.post('/trpc/lavoro.deleteInterview', { data: { id, confirmed: true } });
    }
  });
});

test('Calendario shows a saved interview with its time and opens its application', async ({ page, pc }) => {
  await page.clock.install({ time: new Date(2026, 10, 15, 9, 0) });
  const added = await pc.post('/trpc/lavoro.addInterview', {
    data: {
      key: 'fake-interview-key',
      scheduledAt: new Date(2026, 10, 19, 10, 0).getTime(),
      label: 'Colloquio calendario',
    },
  });
  const { id } = (await added.json()).result.data;
  try {
    await page.goto('/desk/calendar');
    const month = page.getByRole('region', { name: 'novembre 2026' });
    // A click in the cell's corner: the middle may land on its chips, which open the item.
    await month.getByRole('button', { name: 'giovedì 19 novembre' }).click({ position: { x: 20, y: 6 } });
    const panel = page.getByRole('complementary', { name: 'giovedì 19 novembre' });
    await expect(panel.getByText('10:00 · Lavoro, colloquio')).toBeVisible();
    await panel.getByRole('button', { name: /Colloquio calendario/ }).click();
    await expect(page).toHaveURL(/job=fake-interview-key/);
  } finally {
    await pc.post('/trpc/lavoro.deleteInterview', { data: { id, confirmed: true } });
  }
});

test('Statistiche names Rete Informatica Lavoro', async ({ page, pc }) => {
  const job = {
    title: 'Rete Stats Posting',
    company: 'Rete Stats Co',
    url: 'https://example.org/rete-stats',
    site: 'reteinformaticalavoro',
  };
  const saved = await pc.post('/trpc/lavoro.importSave', { data: { job } });
  expect(saved.ok()).toBe(true);
  const { key } = (await saved.json()).result.data;
  expect((await pc.post('/trpc/lavoro.setApplication', { data: { key, status: 'pending' } })).ok()).toBe(true);
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk/ricerca?tab=statistiche');
  await expect(page.getByRole('rowheader', { name: 'Rete Informatica Lavoro' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('rowheader', { name: 'reteinformaticalavoro' })).toHaveCount(0);
});

test('Statistiche lists the postings just under the threshold with what is missing and why', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.goto('/desk/ricerca?tab=statistiche');
  const table = page.getByRole('table', { name: 'Appena sotto soglia' });
  await expect(table).toBeVisible({ timeout: 10000 });
  const row = table.getByRole('row', { name: /Tecnico manutentore/ });
  await expect(row.getByRole('link', { name: 'Tecnico manutentore' })).toHaveAttribute(
    'href',
    'https://example.com/near/1',
  );
  await expect(row.getByRole('cell', { name: 'Near Works', exact: true })).toBeVisible();
  await expect(row.getByText('mancano 2 punti')).toBeVisible();
  await expect(row.getByText('tecnico:+2, manutentore:+1')).toBeVisible();
  await expect(table.getByRole('row', { name: /Addetto manutentore/ }).getByText('manca 1 punto')).toBeVisible();
  // "manutentore" is in both titles and each posting would clear the score with +2.
  await expect(
    page
      .getByRole('table', { name: 'Parole da promuovere' })
      .getByText('2 annunci, con +2 nel titolo ne entrerebbero 2'),
  ).toBeVisible();
});

test.describe('Annunci grouped by Possibilità', () => {
  type Possibility = 'alta' | 'media' | 'bassa' | 'fuori';
  const fixture: {
    title: string;
    company: string;
    total: number;
    possibility: Possibility;
    unverified?: string[];
    applied?: boolean;
  }[] = [
    { title: 'Gruppo Alfa uno', company: 'Alfa Srl', total: 20, possibility: 'alta' },
    { title: 'Gruppo Alfa due', company: 'Beta Srl', total: 22, possibility: 'alta' },
    { title: 'Gruppo Media uno', company: 'Gamma Srl', total: 12, possibility: 'media', unverified: ['RAL'] },
    { title: 'Gruppo Media due', company: 'Delta Srl', total: 18, possibility: 'media', unverified: ['RAL'] },
    { title: 'Gruppo Bassa uno', company: 'Zeta Srl', total: 30, possibility: 'bassa' },
    { title: 'Gruppo Bassa due', company: 'Eta Srl', total: 7, possibility: 'bassa' },
    { title: 'Gruppo Fuori uno', company: 'Iota Srl', total: 28, possibility: 'fuori' },
    { title: 'Gruppo Gia candidato', company: 'Theta Srl', total: 25, possibility: 'fuori', applied: true },
  ];

  test('bulk archive requires a hold and archives only the collapsed fuori group', async ({ page, pc }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    const schema = z.object({
      result: z.object({
        data: z.object({
          jobs: z.array(
            z.object({
              key: z.string(),
              archivedAt: z.number().nullable(),
              deletedAt: z.number().nullable(),
              application: z.unknown().nullable(),
            }),
          ),
        }),
      }),
    });
    const readJobs = async () => schema.parse(await (await pc.get('/trpc/lavoro.list')).json()).result.data.jobs;
    const keys: string[] = [];
    for (let index = 0; index < 5; index++) {
      const response = await pc.post('/trpc/lavoro.importSave', {
        data: {
          job: {
            title: `Archiviazione gruppo ${index}`,
            company: 'Fixture Srl',
            url: `https://example.com/bulk-archive-${index}`,
          },
        },
      });
      expect(response.ok()).toBe(true);
      const result = z
        .object({ result: z.object({ data: z.object({ key: z.string() }) }) })
        .parse(await response.json());
      keys.push(result.result.data.key);
    }
    const outsideKeys = keys.slice(0, 2);
    const possibilities = ['fuori', 'fuori', 'alta', 'media', 'bassa'];
    await page.route('**/trpc/*lavoro.list*', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      for (const reply of Array.isArray(body) ? body : [body]) {
        const jobs = reply.result?.data?.jobs;
        if (!Array.isArray(jobs)) continue;
        reply.result.data.jobs = jobs
          .filter((job) => keys.includes(job.key))
          .map((job) => ({
            ...job,
            opinion: {
              verdict: possibilities[keys.indexOf(job.key)],
              possibility: possibilities[keys.indexOf(job.key)],
              codes: [],
              unverified: [],
              outdated: false,
            },
          }));
      }
      await route.fulfill({ response, json: body });
    });
    try {
      await page.goto('/desk/ricerca');
      const group = page.getByRole('region', { name: 'Fuori dai vincoli 2' });
      await expect(group.getByRole('button', { name: 'Mostra' })).toBeVisible();
      await expect(group.locator('[data-posting-key]')).toHaveCount(0);
      const archive = group.getByRole('button', {
        name: 'Tieni premuto per archiviare tutti gli annunci fuori dai vincoli',
      });
      let requests = 0;
      page.on('request', (request) => {
        if (request.url().includes('lavoro.setFlag')) requests++;
      });
      await archive.click();
      expect(requests).toBe(0);
      await expect(group.getByRole('heading', { name: 'Fuori dai vincoli 2' })).toBeVisible();
      expect((await readJobs()).filter((job) => keys.includes(job.key) && job.archivedAt !== null)).toHaveLength(0);
      await expect(group).toHaveScreenshot('lavoro-fuori-bulk-archive.png');
      await holdButton(page, archive);
      await expect(group).toHaveCount(0);
      await expect
        .poll(async () =>
          (await readJobs())
            .filter((job) => keys.includes(job.key) && job.archivedAt !== null)
            .map((job) => job.key)
            .toSorted(),
        )
        .toEqual(outsideKeys.toSorted());
      for (const name of ['Possibilità alta 1', 'Possibilità media 1', 'Possibilità bassa 1']) {
        const otherGroup = page.getByRole('region', { name, exact: true });
        await expect(otherGroup.getByRole('heading', { name, exact: true })).toBeVisible();
        await expect(otherGroup.getByRole('button', { name: /Tieni premuto per archiviare tutti/ })).toHaveCount(0);
      }
    } finally {
      await pc.post('/trpc/lavoro.setFlag', { data: { keys, flag: 'deleted', value: true } });
    }
  });

  test('groups with their counts, the sort switch, closed groups and navigation order', async ({ page }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    // The list is rewritten in the browser so the groups do not depend on what other specs left in the shared database.
    const openWithFixture = async () => {
      await page.goto('/desk/ricerca');
      await page.getByRole('button', { name: 'Raccogli', exact: true }).click();
      await expect(page.getByRole('button', { name: /^Da valutare \d+$/ })).toBeVisible({ timeout: 10000 });
      await page.route('**/trpc/lavoro.list*', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        const replies = Array.isArray(body) ? body : [body];
        for (const reply of replies) {
          const jobs = reply.result?.data?.jobs;
          if (!Array.isArray(jobs) || jobs.length === 0) continue;
          reply.result.data.jobs = fixture.map((row, i) => ({
            ...jobs[0],
            key: `group-fixture-${i}`,
            title: row.title,
            company: row.company,
            total: row.total,
            score: row.total,
            firstSeen: 1000 + i,
            postedAt: 1000 + i,
            application: null,
            companyApplications: row.applied ? [{ title: 'Altro ruolo', appliedAt: 5, status: 'pending' }] : [],
            opinion: {
              verdict: row.possibility,
              possibility: row.possibility,
              codes: [],
              unverified: row.unverified ?? [],
              outdated: false,
            },
          }));
        }
        await route.fulfill({ response, json: body });
      });
      await page.evaluate(() => sessionStorage.clear());
      await page.reload();
      await expect(page.getByRole('heading', { name: /^Possibilità alta/ })).toBeVisible();
    };
    await openWithFixture();

    // P7: default sort name and the Interesse badge
    await expect(page.getByRole('button', { name: 'Ordina: Possibilità, poi interesse' })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Interesse 22' })).toBeVisible();

    // P5: each count equals its cards; bassa is open, fuori is closed, and no Già candidato group exists
    const section = (name: RegExp) => page.getByRole('region', { name });
    await expect(page.getByRole('heading', { name: 'Possibilità alta 2' })).toBeVisible();
    await expect(section(/^Possibilità alta/).locator('[data-posting-key]')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Possibilità media 2' })).toBeVisible();
    await expect(section(/^Possibilità media/).locator('[data-posting-key]')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Possibilità bassa 2' })).toBeVisible();
    await expect(section(/^Possibilità bassa/).locator('[data-posting-key]')).toHaveCount(2);
    await expect(page.getByRole('heading', { name: 'Fuori dai vincoli 2' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Già candidato/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Senza parere/ })).toHaveCount(0);

    // P6: the missing-fact line is "Non detto", the old line is gone
    await expect(section(/^Possibilità media/).getByText('Non detto: RAL', { exact: true })).toHaveCount(2);
    await expect(page.getByText(/Da chiedere/)).toHaveCount(0);

    // Inside a group: Interesse descending, even in bassa
    await expect(section(/^Possibilità alta/).getByRole('heading', { level: 4 })).toHaveText([
      'Gruppo Alfa due',
      'Gruppo Alfa uno',
    ]);
    await expect(section(/^Possibilità bassa/).getByRole('heading', { level: 4 })).toHaveText([
      'Gruppo Bassa uno',
      'Gruppo Bassa due',
    ]);

    // Closed on load, Mostra opens both fuori postings (keeping the Già candidato badge), and reload keeps it open
    await expect(page.getByText('Gruppo Fuori uno')).toHaveCount(0);
    await expect(page.getByText('Gruppo Gia candidato')).toHaveCount(0);
    await section(/^Fuori dai vincoli/)
      .getByRole('button', { name: 'Mostra' })
      .click();
    await expect(page.getByText('Gruppo Fuori uno')).toBeVisible();
    await expect(section(/^Fuori dai vincoli/).getByText('Gruppo Gia candidato')).toBeVisible();
    await expect(section(/^Fuori dai vincoli/).getByText('Già candidato')).toHaveCount(1);
    await page.reload();
    await expect(page.getByText('Gruppo Fuori uno')).toBeVisible();
    await section(/^Fuori dai vincoli/)
      .getByRole('button', { name: 'Nascondi' })
      .click();
    await expect(page.getByText('Gruppo Fuori uno')).toHaveCount(0);
    await expect(page.getByText('Gruppo Gia candidato')).toHaveCount(0);

    // The arrows follow the visible order and skip the closed groups
    await page.getByText('Gruppo Alfa uno').click();
    const dialog = page.locator('dialog[open]');
    await expect(dialog.getByText('2 di 6')).toBeVisible();
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByText('3 di 6')).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Gruppo Media due' })).toBeVisible();
    await page.keyboard.press('Escape');

    // Choosing Interesse removes the headings and gives a flat list by score
    await page.getByRole('button', { name: 'Ordina: Possibilità, poi interesse' }).click();
    await page.getByRole('option', { name: 'Interesse', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Possibilità alta/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 4 }).first()).toHaveText('Gruppo Bassa uno');
  });
});

test('the agent read queries are in the registry and out of the command palette', async ({ page, pc }) => {
  const registry = (await (await pc.get('/trpc/registry.list')).json()).result.data;
  for (const path of ['lavoro.posting', 'lavoro.shortlist'])
    expect(registry.some((item: { path: string; kind: string }) => item.path === path && item.kind === 'query')).toBe(
      true,
    );
  await page.goto('/desk');
  await page.getByRole('button', { name: 'Cerca o esegui, scorciatoia Ctrl K' }).click();
  const palette = page.getByRole('dialog', { name: 'Comandi' });
  for (const label of ['Leggi annuncio', 'Elenco breve']) {
    await palette.getByRole('combobox').fill(label);
    await expect(palette.getByRole('option', { name: new RegExp(label) })).toHaveCount(0);
  }
});

test.describe('Candidature cards: days sent, last mail, next interview', () => {
  // Pinned so the interview time reads the same on any machine: 14:00 UTC is 15:00 in Rome.
  test.use({ timezoneId: 'Europe/Rome' });
  const day = 86_400_000;
  const now = Date.UTC(2026, 10, 16, 12);
  const interviewAt = Date.UTC(2026, 10, 19, 14);
  const application = (daysAgo: number, extra: object = {}) => ({
    appliedAt: now - daysAgo * day,
    status: 'pending',
    closedAt: null,
    reason: null,
    notes: null,
    interviews: [],
    lastMail: null,
    ...extra,
  });
  const fixture = [
    { title: 'Scheda quattro giorni', application: application(4) },
    {
      title: 'Scheda con mail',
      application: application(3, { lastMail: { at: now - day, kind: 'invito' } }),
    },
    {
      title: 'Scheda con colloquio',
      application: application(9, {
        status: 'interviewing',
        interviews: [{ id: 1, key: 'card-fixture-2', scheduledAt: interviewAt, label: 'Colloquio tecnico' }],
      }),
    },
    { title: 'Scheda sedici giorni', application: application(16) },
    { title: 'Scheda dieci giorni', application: application(10) },
  ];

  test('the card says how long ago, what came back and what is next, without the score', async ({ page }) => {
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.clock.install({ time: now });
    // The list is rewritten in the browser so the cards do not depend on what other specs left in the database.
    await page.route('**/trpc/*lavoro.list*', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const replies = Array.isArray(body) ? body : [body];
      for (const reply of replies) {
        const jobs = reply.result?.data?.jobs;
        if (!Array.isArray(jobs) || jobs.length === 0) continue;
        reply.result.data.jobs = fixture.map((row, i) => ({
          ...jobs[0],
          key: `card-fixture-${i}`,
          title: row.title,
          company: 'Esempio Srl',
          location: 'Exampleville',
          total: 22,
          score: 22,
          description: 'Retribuzione: 1.800 - 2.000 €/mese.',
          application: row.application,
        }));
      }
      await route.fulfill({ response, json: body });
    });
    await page.goto('/desk/ricerca?tab=candidature&candidature=all');
    const card = (title: string) =>
      page.locator('div.group').filter({ has: page.getByRole('heading', { name: title }) });

    // C1: the age is the large text under "Inviata", and it moves with the clock.
    const four = card('Scheda quattro giorni');
    await expect(four.getByText('Inviata')).toBeVisible();
    await expect(four.getByText('4 giorni fa', { exact: true })).toBeVisible();

    // C2: no score on the card, no chips (the salary line is in the posting, not here).
    await expect(four.getByText('22', { exact: true })).toHaveCount(0);
    await expect(four.getByText(/€/)).toHaveCount(0);

    // C3: the newest linked mail by day and kind; none reads "nessuna".
    await expect(card('Scheda con mail').getByText('Ultima mail')).toBeVisible();
    await expect(card('Scheda con mail').getByText('ieri, invito', { exact: true })).toBeVisible();
    await expect(four.getByText('nessuna', { exact: true })).toBeVisible();

    // C4: a planned interview takes the right fact.
    const interview = card('Scheda con colloquio');
    await expect(interview.getByText('Prossimo', { exact: true })).toBeVisible();
    await expect(interview.getByText('gio 19, 15:00 Colloquio tecnico', { exact: true })).toBeVisible();
    await expect(interview.getByText('Ultima mail')).toHaveCount(0);

    // C6: the closing line only in the last week of the 21 days, in plain text.
    await expect(card('Scheda sedici giorni').getByText('si chiude tra 5 giorni')).toBeVisible();
    await expect(card('Scheda dieci giorni').getByText(/si chiude/)).toHaveCount(0);
    await expect(four.getByText(/si chiude/)).toHaveCount(0);

    // C1, the clock moved one day.
    await page.clock.fastForward(day);
    await expect(four.getByText('5 giorni fa', { exact: true })).toBeVisible();
  });
});

// Last of the file on purpose: it adds a posting to Da valutare, which earlier specs count.
test('Aggiungi brings a near miss into Da valutare and it leaves the near-miss list', async ({ page, pc }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/desk/ricerca?tab=statistiche');
  const table = page.getByRole('table', { name: 'Appena sotto soglia' });
  const row = table.getByRole('row', { name: /Addetto manutentore/ });
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.getByRole('button', { name: 'Aggiungi' }).click();
  await expect(table.getByRole('row', { name: /Addetto manutentore/ })).toHaveCount(0);
  await page.goto('/desk/ricerca?sort=score');
  await expect(page.getByRole('button', { name: /^Da valutare \d+$/ })).toBeVisible({ timeout: 10000 });
  await expect(page.getByText('Addetto manutentore').first()).toBeVisible();

  // The near-miss list follows the end of a collection with the page open, no reload (owner had to press Ctrl R).
  await page.goto('/desk/ricerca?tab=statistiche');
  const other = table.getByRole('row', { name: /Tecnico manutentore/ });
  await expect(other).toBeVisible({ timeout: 10000 });
  const added = await pc.post('/trpc/lavoro.addNearMiss', { data: { key: 'near-works-tecnico-manutentore' } });
  expect(added.ok()).toBe(true);
  expect((await pc.post('/trpc/lavoro.raccogli', { data: {} })).ok()).toBe(true);
  await expect(other).toHaveCount(0, { timeout: 15000 });
});

test('Scarta removes one near miss and Scarta tutti confirms before clearing the rest', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/desk/ricerca?tab=statistiche');
  const table = page.getByRole('table', { name: 'Appena sotto soglia' });
  const third = table.getByRole('row', { name: /Cablatore quadri/ });
  const fourth = table.getByRole('row', { name: /Perito elettrotecnico/ });
  await expect(third).toBeVisible({ timeout: 10000 });
  await expect(fourth).toBeVisible();
  await expect(third.getByText(/stabile:/)).toHaveCount(0);

  await third.getByRole('button', { name: 'Scarta' }).click();
  await expect(third).toHaveCount(0);
  await expect(fourth).toBeVisible();

  await page.getByRole('button', { name: 'Scarta tutti' }).click();
  await expect(page.getByText(/Scartare definitivamente 1 annunci appena sotto soglia/)).toBeVisible();
  await page.getByRole('button', { name: 'Scarta tutti' }).click();
  await expect(page.getByText('Nessun annuncio appena sotto soglia.')).toBeVisible();
});

test('missing descriptions distinguish imports, preserve stale-flag text and support targeted retry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  let refetched = false;
  await page.route('**/trpc/*lavoro.list*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const replies = Array.isArray(body) ? body : [body];
    for (const reply of replies) {
      const jobs = reply.result?.data?.jobs;
      if (!Array.isArray(jobs) || jobs.length === 0) continue;
      const base = jobs[0];
      reply.result.data.jobs = [
        {
          ...base,
          key: 'refetch-empty-review',
          importedAt: null,
          title: 'Offerta vuota da valutare',
          company: 'Alpha Srl',
          site: 'indeed',
          url: 'https://example.com/jobs/1',
          description: refetched ? 'Testo recuperato dal sito.' : null,
          descriptionHtml: refetched ? '<p>Testo recuperato dal sito.</p>' : null,
          detailsMissing: !refetched,
          application: null,
          archivedAt: null,
          deletedAt: null,
          blacklistRule: null,
        },
        {
          ...base,
          key: 'refetch-filled-review',
          title: 'Offerta con testo',
          company: 'Beta Srl',
          site: 'indeed',
          url: 'https://example.com/jobs/2',
          description: 'Descrizione già presente.',
          descriptionHtml: null,
          detailsMissing: true,
          application: null,
          archivedAt: null,
          deletedAt: null,
          blacklistRule: null,
        },
        {
          ...base,
          key: 'refetch-empty-applied',
          importedAt: 1000,
          title: 'Candidatura vuota',
          company: 'Gamma Srl',
          site: 'indeed',
          url: 'https://example.com/jobs/3',
          description: null,
          descriptionHtml: null,
          detailsMissing: true,
          application: {
            appliedAt: 1000,
            status: 'pending',
            closedAt: null,
            reason: null,
            notes: null,
            interviews: [],
            lastMail: null,
          },
          archivedAt: null,
          deletedAt: null,
          blacklistRule: null,
        },
      ];
    }
    await route.fulfill({ response, json: body });
  });
  await page.route('**/trpc/*lavoro.refetchDescription*', async (route) => {
    refetched = true;
    const payload = { result: { data: { updated: true, key: 'refetch-empty-review' } } };
    await route.fulfill({ json: route.request().url().includes('batch=1') ? [payload] : payload });
  });

  await page.goto('/desk/ricerca?sort=score');
  await page.getByText('Offerta con testo').first().click();
  const detail = page.locator('dialog[open]').first();
  await expect(detail.getByText('Descrizione già presente.')).toBeVisible();
  await expect(detail.getByRole('button', { name: 'Riprova scaricamento' })).toHaveCount(0);
  await detail.getByRole('button', { name: 'Chiudi' }).click();

  await page.getByText('Offerta vuota da valutare').first().click();
  await expect(detail.getByRole('button', { name: 'Riprova scaricamento' })).toBeVisible();
  await detail.getByRole('button', { name: 'Riprova scaricamento' }).click();
  await expect(detail.getByText('Testo recuperato dal sito.')).toBeVisible({ timeout: 10000 });
  await expect(detail.getByRole('button', { name: 'Riprova scaricamento' })).toHaveCount(0);
  await detail.getByRole('button', { name: 'Chiudi' }).click();

  await page.goto('/desk/ricerca?tab=candidature&candidature=all');
  await page.getByText('Candidatura vuota').first().click();
  await expect(
    detail.getByText('Questa candidatura è stata importata senza la descrizione dell’offerta.'),
  ).toBeVisible();
  await expect(detail.getByText('Dettagli completi non disponibili dal sito sorgente.')).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Riprova scaricamento' })).toBeVisible();
  await expect(
    detail.getByText('Questa candidatura è stata importata senza la descrizione dell’offerta.').locator('..'),
  ).toHaveScreenshot('lavoro-imported-description-empty.png');
});
