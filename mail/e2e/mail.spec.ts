import { expect, test, type Page } from '../../../apps/e2e/tests/fixtures.ts';
import { DECK_STATE, PHONE_URL } from '../../../apps/e2e/tests/hosts.ts';

type ApiClient = {
  get: (url: string) => Promise<{ json: () => Promise<unknown> }>;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

// The list button of a message: the hover actions of its row carry the subject too, so a name alone is ambiguous.
const messageRow = (page: Page, text: string | RegExp) =>
  page
    .getByRole('region', { name: 'Posta in arrivo' })
    .locator('li')
    .filter({ hasText: text })
    .locator('button[aria-pressed]');

test('inbox and reader scroll independently beneath the fixed toolbar', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 750 });
  const rows = Array.from({ length: 25 }, (_, index) => ({
    id: String(index),
    account: 'work',
    subject: `Messaggio ${index}`,
    from: { name: 'Mittente', email: 'sender@example.org' },
    date: '2026-11-07T09:00:00Z',
    seen: true,
    flagged: false,
  }));
  await page.route('**/trpc/mail.inbox*', (route) =>
    route.fulfill({ json: [{ result: { data: { rows, cursor: null } } }] }),
  );
  await page.route('**/trpc/mail.read*', (route) =>
    route.fulfill({ json: [{ result: { data: { text: 'Testo lungo\n'.repeat(200), truncated: false } } }] }),
  );
  await page.goto('/desk/messaggi');
  const inbox = page.getByRole('region', { name: 'Posta in arrivo' });
  await expect(messageRow(page, 'Messaggio 0')).toBeVisible();
  await messageRow(page, 'Messaggio 0').click();
  const toolbar = page.getByRole('textbox', { name: 'Cerca nella posta' });
  await toolbar.focus();
  await expect(toolbar).toBeFocused();
  const before = await toolbar.boundingBox();
  const list = inbox.locator('.overflow-y-auto');
  await list.hover();
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(
    await page
      .locator('main > div')
      .last()
      .evaluate((element) => element.scrollTop),
  ).toBe(0);
  await list.evaluate((element) => {
    element.scrollTop = 0;
  });
  await list.focus();
  await expect(list).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect((await toolbar.boundingBox())?.y).toBe(before?.y);
  const reader = page.getByRole('region', { name: 'Messaggio 0' });
  await reader.hover();
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => reader.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('the inbox shows loading until its first list arrives', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/trpc/mail.inbox*', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/desk/messaggi');
  const inbox = page.getByRole('region', { name: 'Posta in arrivo' });
  await expect(inbox.getByRole('status', { name: 'Caricamento...' })).toBeVisible();
  await expect(inbox.getByText('Nessun messaggio')).toHaveCount(0);
  const before = await inbox.boundingBox();
  release();
  await expect(messageRow(page, 'Offerta di colloquio')).toBeVisible();
  const after = await inbox.boundingBox();
  if (!before || !after) throw new Error('Inbox must remain laid out');
  expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(8);
  expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(8);
  expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(8);
  expect(Math.abs(before.height - after.height)).toBeLessThanOrEqual(8);
});

test('reader and reply hold their positions while their data loads', async ({ page }) => {
  await page.setViewportSize({ width: 3840, height: 2160 });
  let releaseRead = () => {};
  let releaseDraft = () => {};
  const read = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const draft = new Promise<void>((resolve) => {
    releaseDraft = resolve;
  });
  await page.route('**/trpc/mail.read*', async (route) => {
    await read;
    await route.continue();
  });
  await page.route('**/trpc/mail.replyDraft*', async (route) => {
    await draft;
    await route.continue();
  });
  await page.goto('/desk/messaggi');
  await messageRow(page, 'Offerta di colloquio').click();
  const reader = page.getByRole('region', { name: 'Offerta di colloquio' });
  await expect(reader.getByRole('status', { name: 'Caricamento' })).toBeVisible();
  const before = await reader.boundingBox();
  releaseRead();
  await expect(reader.getByRole('status', { name: 'Caricamento' })).toHaveCount(0);
  const after = await reader.boundingBox();
  if (!before || !after) throw new Error('Reader must remain laid out');
  expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(8);
  expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(8);
  expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(8);
  expect(Math.abs(before.height - after.height)).toBeLessThanOrEqual(8);
  await reader.getByRole('button', { name: 'Rispondi' }).click();
  const skeleton = reader.getByRole('status', { name: 'Preparo la risposta' });
  await expect(skeleton).toBeVisible();
  const loading = await skeleton.boundingBox();
  releaseDraft();
  const form = page.getByRole('form', { name: 'Rispondi' });
  await expect(form).toBeVisible();
  const loaded = await form.boundingBox();
  if (!loading || !loaded) throw new Error('Reply must remain laid out');
  expect(Math.abs(loading.y - loaded.y)).toBeLessThanOrEqual(8);
  expect(Math.abs(loading.x - loaded.x)).toBeLessThanOrEqual(8);
  expect(Math.abs(loading.width - loaded.width)).toBeLessThanOrEqual(8);
});

test('refresh starts the list over without asking the accounts again', async ({ page }) => {
  let addMessage = false;
  await page.route('**/trpc/mail.inbox*', async (route) => {
    const response = await route.fetch();
    const payload: unknown = await response.json();
    if (addMessage && Array.isArray(payload)) {
      const first: unknown = payload[0];
      if (
        typeof first !== 'object' ||
        !first ||
        !('result' in first) ||
        typeof first.result !== 'object' ||
        !first.result ||
        !('data' in first.result) ||
        typeof first.result.data !== 'object' ||
        !first.result.data ||
        !('rows' in first.result.data) ||
        !Array.isArray(first.result.data.rows)
      )
        throw new Error('unexpected mail response');
      first.result.data.rows.push({
        id: 'new',
        account: 'work',
        subject: 'Nuovo messaggio',
        from: { name: 'Mittente', email: 'sender@example.org' },
        date: null,
        seen: false,
        flagged: false,
      });
    }
    await route.fulfill({ response, json: payload });
  });
  await page.goto('/desk/messaggi');
  await expect(messageRow(page, 'Offerta di colloquio')).toBeVisible();
  addMessage = true;
  let accountsAsked = false;
  page.on('request', (request) => {
    if (request.url().includes('mail.accounts')) accountsAsked = true;
  });
  const list = page.waitForResponse((response) => response.url().includes('/trpc/mail.inbox'));
  const state = page.waitForResponse((response) => response.url().includes('mail.refresh'));
  await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
  expect((await list).ok()).toBe(true);
  expect((await state).ok()).toBe(true);
  await expect(messageRow(page, 'Nuovo messaggio')).toBeVisible();
  expect(accountsAsked).toBe(false);
});

test('Messaggi shows the Posta inbox', async ({ page }) => {
  await page.goto('/desk');
  await page.getByRole('link', { name: 'Messaggi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Messaggi' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Posta' })).toBeVisible();
  await expect(messageRow(page, 'Offerta di colloquio')).toBeVisible();
});

test('read and star actions change the message state', async ({ page, pc }) => {
  try {
    await page.goto('/desk/messaggi');
    await messageRow(page, 'Offerta di colloquio').click();
    await page.getByRole('button', { name: 'Segna come letto' }).click();
    await expect(page.getByRole('button', { name: 'Segna come non letto' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Segna come non letto' })).toHaveAttribute('aria-pressed', 'true');
    await expect(messageRow(page, 'Offerta di colloquio').filter({ hasText: 'Non letto' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Contrassegna', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Contrassegna', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(
      messageRow(page, 'Offerta di colloquio').filter({ hasText: 'Contrassegnato' }).locator('svg'),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Segna come non letto' }).click();
    await expect(page.getByRole('button', { name: 'Segna come letto' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Segna come letto' })).toHaveAttribute('aria-pressed', 'false');
    await expect(messageRow(page, 'Offerta di colloquio').filter({ hasText: 'Non letto' })).toBeVisible();
    await page.getByRole('button', { name: 'Contrassegna', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Contrassegna', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(messageRow(page, 'Offerta di colloquio').filter({ hasText: 'Contrassegnato' })).toHaveCount(0);
  } finally {
    await pc.post('/trpc/mail.setSeen', { data: { account: 'work', ids: ['310'], seen: false } });
    await pc.post('/trpc/mail.setFlagged', { data: { account: 'work', ids: ['310'], flagged: false } });
  }
});

test('Tutte merges the accounts with their labels, each account shows only its own, search narrows, reading keeps unread', async ({
  page,
  pc,
}) => {
  await page.goto('/desk/messaggi');
  const inbox = page.getByRole('region', { name: 'Posta in arrivo' });
  const accounts = page.getByRole('toolbar', { name: 'Account' });
  await expect(accounts.getByRole('button', { name: 'Tutte' })).toHaveAttribute('aria-pressed', 'true');
  await expect(messageRow(page, 'Offerta di colloquio')).toContainText('Lavoro');
  await expect(messageRow(page, 'Iscrizione al club')).toContainText('Personale');
  await accounts.getByRole('button', { name: 'Personale' }).click();
  await expect(messageRow(page, 'Iscrizione al club')).toBeVisible();
  await expect(messageRow(page, 'Offerta di colloquio')).toHaveCount(0);
  await accounts.getByRole('button', { name: 'Lavoro' }).click();
  const search = page.getByRole('textbox', { name: 'Cerca nella posta' });
  await search.fill('vorremmo');
  await search.press('Enter');
  await expect(inbox.getByRole('listitem')).toHaveCount(1);
  await expect(messageRow(page, 'Offerta di colloquio')).toBeVisible();
  await expect(messageRow(page, 'Newsletter di prova')).toHaveCount(0);
  await messageRow(page, 'Offerta di colloquio').click();
  await expect(page.getByText('vorremmo proporle un colloquio.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Segna come letto' })).toBeVisible();
  await expect(messageRow(page, 'Offerta di colloquio').filter({ hasText: 'Non letto' })).toBeVisible();
  const trace = JSON.stringify(await (await pc.get('/m/mail/fake-calls')).json());
  expect(trace).toContain('"message","read"');
  expect(trace).not.toContain('--seen');
});

test('Filtri applies a sender and an unread filter as chips, and a typed day sets Dopo il', async ({ page }) => {
  await page.goto('/desk/messaggi');
  const inbox = page.getByRole('region', { name: 'Posta in arrivo' });
  await page.getByRole('button', { name: 'Filtri', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Filtri' });
  await dialog.getByRole('textbox', { name: 'Mittente' }).fill('carla');
  await dialog.getByRole('switch', { name: 'Solo non lette' }).click();
  await dialog.getByRole('textbox', { name: 'Dopo il' }).fill('ieri');
  await dialog.getByRole('textbox', { name: 'Dopo il' }).press('Enter');
  const yesterday = new Date(Date.now() - 86_400_000);
  const written = new Intl.DateTimeFormat('it-IT', { weekday: 'long', day: 'numeric', month: 'long' }).format(
    yesterday,
  );
  await expect(dialog.getByText(written)).toBeVisible();
  await expect(dialog.getByRole('button', { pressed: true, name: new RegExp(`^${written}`, 'i') })).toBeVisible();
  await dialog.getByRole('button', { name: 'Applica' }).click();
  await expect(page.getByRole('button', { name: 'Filtri, 3 attivi' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rimuovi Mittente: carla' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Rimuovi Solo non lette' })).toBeVisible();
  // Nothing from the fixture is both unread, from carla and after yesterday.
  await expect(inbox.getByRole('heading', { name: 'Nessun messaggio' })).toBeVisible();
  await page.getByRole('button', { name: 'Rimuovi Mittente: carla' }).click();
  await page.getByRole('button', { name: 'Rimuovi Solo non lette' }).click();
  await page.getByRole('button', { name: /^Rimuovi Dopo il/ }).click();
  await expect(messageRow(page, 'Offerta di colloquio')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filtri', exact: true })).toBeVisible();
});

test('the mail UI is absent when its procedures are not configured', async ({ page }) => {
  await page.route('**/trpc/mail.accounts*', (route) => route.fulfill({ status: 404, body: '{}' }));
  const unavailable = page.waitForResponse((response) => response.url().includes('/trpc/mail.accounts'));
  await page.goto('/desk');
  await unavailable;
  await expect(page.getByRole('link', { name: 'Messaggi', exact: true })).toHaveCount(0);
});

test('a failed inbox can be retried', async ({ page, pc }) => {
  try {
    expect((await pc.post('/m/mail/fake-fail', { data: { fail: true } })).ok()).toBe(true);
    await page.goto('/desk/messaggi');
    await expect(page.getByText('Impossibile caricare la posta')).toBeVisible();
    await pc.post('/m/mail/fake-fail', { data: { fail: false } });
    await page.getByRole('button', { name: 'Riprova' }).click();
    await expect(messageRow(page, 'Offerta di colloquio')).toBeVisible();
  } finally {
    await pc.post('/m/mail/fake-fail', { data: { fail: false } });
  }
});

test('reopening Posta shows the cached inbox without reading the mailbox again', async ({ page }) => {
  let reads = 0;
  page.on('request', (request) => {
    if (request.url().includes('mail.inbox')) reads++;
  });
  await page.goto('/desk/messaggi');
  const inbox = page.getByRole('region', { name: 'Posta in arrivo' });
  await expect(messageRow(page, 'Offerta di colloquio')).toBeVisible();
  const zones = page.getByRole('navigation', { name: 'Zone' });
  await zones.getByRole('link', { name: 'Panoramica' }).click();
  await zones.getByRole('link', { name: 'Messaggi' }).click();
  // The list is there at once, from the cache: no loading rows, no second read.
  await expect(messageRow(page, 'Offerta di colloquio')).toBeVisible();
  await expect(inbox.getByRole('status', { name: 'Caricamento...' })).toHaveCount(0);
  expect(reads).toBe(1);
});

/** The `work` offset of the merged cursor in a batched `mail.inbox` call (no transformer: `{"0":{...,"cursor":{...}}}`). */
function workOffset(input: string | null): number {
  const batch: unknown = JSON.parse(input ?? '{}');
  const call = typeof batch === 'object' && batch && '0' in batch ? batch[0] : null;
  const cursor = typeof call === 'object' && call && 'cursor' in call ? call.cursor : null;
  return typeof cursor === 'object' && cursor && 'work' in cursor ? Number(cursor.work) : 0;
}

/** Every himalaya argv the fake was asked (`GET /m/mail/fake-calls`). */
async function fakeCalls(pc: ApiClient): Promise<string[][]> {
  const body: unknown = await (await pc.get('/m/mail/fake-calls')).json();
  const calls = typeof body === 'object' && body && 'calls' in body ? body.calls : [];
  return Array.isArray(calls) ? calls.filter((call): call is string[] => Array.isArray(call)) : [];
}

async function hold(page: Page, name: string) {
  await page.getByRole('button', { name }).focus();
  await page.keyboard.down('Space');
  await page.waitForTimeout(1000);
  await page.keyboard.up('Space');
}

const rowFor = (id: number, account = 'work') => ({
  id: `p${id}`,
  account,
  subject: `Messaggio ${id}`,
  from: { name: 'Mittente', email: 'sender@example.org' },
  date: '2026-11-07T09:00:00Z',
  seen: true,
  flagged: false,
});

test('the list reads the next page when its end shows, then says there is no more, and Aggiorna starts over', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 750 });
  const pages = [0, 1, 2].map((index) =>
    Array.from({ length: index === 2 ? 10 : 25 }, (_, row) => rowFor(index * 25 + row)),
  );
  const cursors: (string | null)[] = [];
  await page.route('**/trpc/mail.inbox*', (route) => {
    const next = workOffset(new URL(route.request().url()).searchParams.get('input'));
    cursors.push(next === 0 ? null : String(next));
    const index = next / 25;
    return route.fulfill({
      json: [{ result: { data: { rows: pages[index] ?? [], cursor: index < 2 ? { work: next + 25 } : null } } }],
    });
  });
  await page.goto('/desk/messaggi');
  const inbox = page.getByRole('region', { name: 'Posta in arrivo' });
  await expect(messageRow(page, 'Messaggio 0')).toBeVisible();
  const list = inbox.locator('.overflow-y-auto');
  await expect(inbox.getByText('Carico altre mail')).toBeVisible();
  await list.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect(messageRow(page, 'Messaggio 25')).toBeAttached();
  await list.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect(messageRow(page, 'Messaggio 59')).toBeAttached();
  await list.evaluate((element) => element.scrollTo(0, element.scrollHeight));
  await expect(inbox.getByText('Non ci sono altre mail')).toBeVisible();
  expect(cursors).toEqual([null, '25', '50']);
  await page.getByRole('button', { name: 'Aggiorna', exact: true }).click();
  await expect.poll(() => cursors.length).toBeGreaterThan(3);
  await expect(messageRow(page, 'Messaggio 59')).toHaveCount(0);
});

test('Archivia moves the message out of the list and Annulla brings it back', async ({ page }) => {
  await page.goto('/desk/messaggi');
  const inbox = page.getByRole('region', { name: 'Posta in arrivo' });
  await messageRow(page, 'Newsletter di prova').click();
  await page.getByRole('region', { name: 'Newsletter di prova' }).getByRole('button', { name: 'Archivia' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Mail archiviata' })).toBeVisible();
  await expect(messageRow(page, 'Newsletter di prova')).toHaveCount(0);
  await page.getByRole('button', { name: 'Annulla', exact: true }).click();
  await expect(messageRow(page, 'Newsletter di prova')).toBeVisible();
  await expect(inbox.getByRole('listitem')).toHaveCount(4);
});

test('a row archives from its own hover button', async ({ page }) => {
  await page.goto('/desk/messaggi');
  await messageRow(page, 'Iscrizione al club').hover();
  await page.getByRole('button', { name: 'Archivia: Iscrizione al club' }).click();
  await expect(messageRow(page, 'Iscrizione al club')).toHaveCount(0);
  await page.getByRole('button', { name: 'Annulla', exact: true }).click();
  await expect(messageRow(page, 'Iscrizione al club')).toBeVisible();
});

test('Rispondi shows the recipient and the quote, a hold sends one reply and the form closes', async ({ page, pc }) => {
  await page.goto('/desk/messaggi');
  await messageRow(page, 'Offerta di colloquio').click();
  const reader = page.getByRole('region', { name: 'Offerta di colloquio' });
  await reader.getByRole('button', { name: 'Rispondi' }).click();
  const form = page.getByRole('form', { name: 'Rispondi' });
  await expect(form).toContainText('recruiter@example.org');
  await expect(form.getByText('Re: Offerta di colloquio')).toBeVisible();
  await form.getByText(/Testo citato \(\d+ righe\)/).click();
  await expect(form.getByText('> vorremmo proporle un colloquio.')).toBeVisible();
  await form.getByRole('textbox', { name: 'Testo della risposta' }).fill('Volentieri, confermo.');
  await hold(page, 'Invia la risposta, tieni premuto');
  await expect(form).toHaveCount(0);
  await expect(reader.getByRole('status').filter({ hasText: 'Mail inviata' })).toBeVisible();
  const trace = await fakeCalls(pc);
  const sends = trace.filter((call) => call.includes('--send') && call.includes('reply'));
  expect(sends).toHaveLength(1);
  expect(sends[0]).toContain('--body=Volentieri, confermo.');
});

const composeSends = async (pc: ApiClient) =>
  (await fakeCalls(pc)).filter((call) => call.includes('compose') && call.includes('--send'));

async function fillCompose(page: Page, address: string) {
  await page.goto('/desk/messaggi');
  await page.getByRole('button', { name: 'Scrivi', exact: true }).click();
  const form = page.getByRole('form', { name: 'Nuova mail' });
  const to = form.getByRole('combobox', { name: 'A' });
  await to.fill(address);
  await to.press('Enter');
  await form.getByRole('textbox', { name: 'Oggetto' }).fill('Appunti');
  await form.getByRole('textbox', { name: 'Testo' }).fill('Ciao Marta');
  return form;
}

test('Scrivi with an invalid address shows the line and sends nothing', async ({ page, pc }) => {
  const before = (await composeSends(pc)).length;
  const form = await fillCompose(page, 'non-un-indirizzo');
  await hold(page, 'Invia la mail, tieni premuto');
  await expect(form.getByRole('alert')).toHaveText('Indirizzo non valido');
  expect((await composeSends(pc)).length).toBe(before);
});

test('Scrivi sends a new mail with a hold and closes', async ({ page, pc }) => {
  const before = (await composeSends(pc)).length;
  const form = await fillCompose(page, 'marta@example.org');
  await hold(page, 'Invia la mail, tieni premuto');
  await expect(form).toHaveCount(0);
  const sends = await composeSends(pc);
  expect(sends).toHaveLength(before + 1);
  expect(sends.at(-1)).toEqual(
    expect.arrayContaining(['--to=marta@example.org', '--subject=Appunti', '--body=Ciao Marta', '--save', 'sent']),
  );
});

test('a failed send keeps the form and its text and shows one error line', async ({ page, pc }) => {
  try {
    const form = await fillCompose(page, 'marta@example.org');
    await pc.post('/m/mail/fake-fail', { data: { fail: true } });
    await hold(page, 'Invia la mail, tieni premuto');
    await expect(form.getByRole('alert')).toHaveText('Non riesco a inviare la mail');
    await expect(form.getByRole('textbox', { name: 'Testo' })).toHaveValue('Ciao Marta');
    await expect(form.getByRole('textbox', { name: 'Oggetto' })).toHaveValue('Appunti');
  } finally {
    await pc.post('/m/mail/fake-fail', { data: { fail: false } });
  }
});

test('Posta widget shows unread count, Piccolo and Medio align and fit at 4K and 1080p, and skeleton holds geometry', async ({
  page,
  pc,
}) => {
  try {
    await pc.post('/trpc/layout.save', {
      data: { zone: 'overview', items: [{ widget: 'mail', size: 'small', x: 0, y: 0 }] },
    });
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.goto('/desk');
    const small = page.getByRole('region', { name: 'Posta' });
    await expect(small.locator('[data-readout] [aria-hidden="true"]').getByText('3', { exact: true })).toBeVisible();
    await expect(small.getByRole('paragraph').first()).toMatchAriaSnapshot('- paragraph: 3 non lette');
    await expect(small.getByText('Lavoro, Personale', { exact: true })).toBeVisible();
    await expect(small.getByText(/^ultima: Recruiter Example/)).toBeVisible();
    expect(await small.getByRole('button').count()).toBe(0);
    for (const width of [3840, 1920]) {
      await page.setViewportSize({ width, height: width === 3840 ? 2160 : 1080 });
      await expect
        .poll(() => small.evaluate((el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth))
        .toBe(true);
    }

    await pc.post('/trpc/layout.save', {
      data: { zone: 'overview', items: [{ widget: 'mail', size: 'medium', x: 0, y: 0 }] },
    });
    await page.setViewportSize({ width: 3840, height: 2160 });
    await page.goto('/desk');
    const medium = page.getByRole('region', { name: 'Posta' });
    await expect(medium.getByRole('listitem')).toHaveCount(3);
    await expect(medium.getByText('Recruiter Example · Offerta di colloquio')).toBeVisible();
    await expect(medium.getByText('Club Example · Iscrizione al club')).toBeVisible();
    await expect(medium.getByText('news@example.org · Newsletter di prova')).toBeVisible();
    await medium.getByRole('link', { name: /Offerta di colloquio/ }).click();
    await expect(page).toHaveURL(/\/desk\/messaggi/);

    await pc.post('/trpc/layout.save', {
      data: { zone: 'overview', items: [{ widget: 'mail', size: 'small', x: 0, y: 0 }] },
    });
    let release = () => {};
    await page.routeWebSocket(/\/trpc/, (socket) => {
      const server = socket.connectToServer();
      const ids = new Set<unknown>();
      const waiting: (string | Buffer)[] = [];
      let released = false;
      release = () => {
        released = true;
        for (const message of waiting) socket.send(message);
      };
      socket.onMessage((message) => {
        const value: unknown = JSON.parse(message.toString());
        for (const item of Array.isArray(value) ? value : [value]) {
          if (isObject(item) && isObject(item.params) && item.params.path === 'mail.onState') ids.add(item.id);
        }
        server.send(message);
      });
      server.onMessage((message) => {
        const value: unknown = JSON.parse(message.toString());
        if (!released && isObject(value) && ids.has(value.id) && isObject(value.result) && value.result.type === 'data')
          waiting.push(message);
        else socket.send(message);
      });
    });
    try {
      await page.setViewportSize({ width: 3840, height: 2160 });
      await page.goto('/desk');
      const widget = page.locator('[data-widget="mail"]');
      const skeleton = widget.getByRole('status', { name: 'Caricamento' });
      await expect(skeleton).toBeVisible();
      const before = await widget.boundingBox();
      release();
      await expect(skeleton).toHaveCount(0);
      const after = await widget.boundingBox();
      if (!before || !after) throw new Error('Widget must remain laid out');
      expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(8);
      expect(Math.abs(before.y - after.y)).toBeLessThanOrEqual(8);
      expect(Math.abs(before.width - after.width)).toBeLessThanOrEqual(8);
      expect(Math.abs(before.height - after.height)).toBeLessThanOrEqual(8);
    } finally {
      release();
    }
  } finally {
    await pc.post('/trpc/layout.reset', { data: { zone: 'overview' } });
  }
});

test('Posta deck tile shows unread count without reading mail contents', async ({ browser, pc }) => {
  const context = await browser.newContext({ storageState: DECK_STATE, viewport: { width: 375, height: 812 } });
  const unreadIds = async (account: string) => {
    const res = await pc.get(`/trpc/mail.list?input=${encodeURIComponent(JSON.stringify({ account }))}`);
    const body: unknown = await res.json();
    const list = isObject(body) && isObject(body.result) && Array.isArray(body.result.data) ? body.result.data : [];
    return list
      .filter(
        (row): row is { id: string; seen: boolean } =>
          isObject(row) && typeof row.id === 'string' && row.seen === false,
      )
      .map((row) => row.id);
  };
  let workIds: string[] = [];
  let personalIds: string[] = [];
  try {
    const page = await context.newPage();
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(`${PHONE_URL}/deck`);
    await expect(page.getByRole('group', { name: 'Posta: 3 non lette' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Posta: 3 non lette' })).toHaveCount(0);
    workIds = await unreadIds('work');
    personalIds = await unreadIds('personal');
    if (workIds.length) await pc.post('/trpc/mail.setSeen', { data: { account: 'work', ids: workIds, seen: true } });
    if (personalIds.length)
      await pc.post('/trpc/mail.setSeen', { data: { account: 'personal', ids: personalIds, seen: true } });
    await expect(page.getByRole('group', { name: 'Posta: 0 non lette' })).toBeVisible();
    expect(requests.filter((url) => /mail\.(list|search|read|threads)/.test(url))).toEqual([]);
  } finally {
    if (workIds.length) await pc.post('/trpc/mail.setSeen', { data: { account: 'work', ids: workIds, seen: false } });
    if (personalIds.length)
      await pc.post('/trpc/mail.setSeen', { data: { account: 'personal', ids: personalIds, seen: false } });
    await context.close();
  }
});

test('Posta palette record search matches subjects, cuts at 3 rows and opens linked message', async ({ page }) => {
  const palette = page.getByRole('dialog', { name: 'Comandi' });
  const asked: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('mail.searchRecords')) asked.push(request.url());
  });
  await page.goto('/desk');
  await page.getByRole('button', { name: 'Cerca o esegui, scorciatoia Ctrl K' }).click();
  const field = palette.getByRole('combobox');
  await expect(field).toBeFocused();
  await field.fill('o');
  await page.waitForTimeout(400);
  expect(asked).toEqual([]);
  await field.fill('ol');
  const posta = palette.getByRole('group', { name: /Posta/ });
  await expect(posta.getByRole('option')).toHaveCount(2);
  expect(asked).toHaveLength(1);
  await expect(posta.getByRole('option', { name: /Offerta di colloquio/ })).toContainText('Lavoro');
  await expect(posta.getByRole('option', { name: /Offerta di colloquio/ })).toContainText('Recruiter Example');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/desk\/messaggi\?tab=mail&subject=Offerta\+di\+colloquio&message=work%3A310$/);
  await expect(page.getByRole('region', { name: 'Offerta di colloquio' })).toBeVisible();
});
