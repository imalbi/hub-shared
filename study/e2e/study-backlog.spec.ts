import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';
import { answerQueries } from '../../../apps/e2e/tests/desktop.ts';

for (const width of [3840, 375]) {
  test(`backlog works without an active plan and preserves entries at ${width}px`, async ({ page, pc }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 2160 });
    await answerQueries(page, { 'study.index': null, 'study.active': [] });
    const title = `Corso di esempio ${width}`;
    const revised = `${title} rivisto`;
    try {
      await page.goto('/desk/studio?tab=backlog');
      await expect(page.getByRole('tab')).toHaveText(['Oggi', 'Piano', 'Ripasso', 'Libreria', 'Materie', 'Backlog']);
      await page.getByRole('button', { name: 'Aggiungi al backlog', exact: true }).click();
      const form = page.getByRole('form', { name: 'Aggiungi al backlog' });
      await form.getByRole('textbox', { name: 'Titolo', exact: true }).fill(title);
      await form.getByRole('textbox', { name: 'Note', exact: true }).fill('Un argomento alla volta.');
      await form.getByRole('textbox', { name: 'Link', exact: true }).fill('https://example.com/course');
      await form.getByRole('button', { name: 'Salva', exact: true }).click();
      let row = page.getByRole('listitem', { name: title, exact: true });
      await expect(row.getByText('Un argomento alla volta.')).toBeVisible();
      await expect(row.getByRole('link', { name: 'Link' })).toHaveAttribute('href', 'https://example.com/course');
      await page.reload();
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: 'Modifica', exact: true }).click();
      const edit = row.getByRole('form', { name: 'Modifica' });
      await edit.getByRole('textbox', { name: 'Titolo', exact: true }).fill(revised);
      await edit.getByRole('textbox', { name: 'Note', exact: true }).fill('Nota rivista.');
      await edit.getByRole('button', { name: 'Salva', exact: true }).click();
      row = page.getByRole('listitem', { name: revised, exact: true });
      await expect(row.getByText('Nota rivista.')).toBeVisible();
      await row.getByRole('button', { name: 'Stato: Da studiare', exact: true }).click();
      await page.getByRole('option', { name: 'Completato', exact: true }).click();
      await expect(
        page.getByRole('region', { name: 'Completati', exact: true }).getByRole('listitem', { name: revised }),
      ).toBeVisible();
      await row.getByRole('button', { name: 'Stato: Completato', exact: true }).click();
      await page.getByRole('option', { name: 'In corso', exact: true }).click();
      await expect(
        page.getByRole('region', { name: 'Da studiare e in corso' }).getByRole('listitem', { name: revised }),
      ).toBeVisible();
      await row.getByRole('button', { name: 'Elimina', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Elimina dal backlog?' });
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Annulla', exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(row).toBeVisible();
      await row.getByRole('button', { name: 'Elimina', exact: true }).click();
      await dialog.getByRole('button', { name: 'Elimina', exact: true }).click();
      await expect(row).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    } finally {
      const entries: { id: string; title: string }[] = (await (await pc.get('/trpc/study.backlog')).json()).result.data;
      for (const item of entries.filter((entry) => entry.title === title || entry.title === revised))
        await pc.post('/trpc/study.deleteBacklog', { data: { id: item.id, confirmed: true } });
    }
  });
}

test('backlog keeps a failed save draft and retries after query failure', async ({ page, pc }) => {
  await page.route('**/trpc/*study.backlog*', async (route) => {
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Unavailable', code: -32603 } }),
    });
  });
  await page.goto('/desk/studio?tab=backlog');
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Nessun argomento nel backlog')).toHaveCount(0);
  await page.unroute('**/trpc/*study.backlog*');
  await page.getByRole('button', { name: 'Riprova', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Riprova', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Nessun argomento nel backlog' })).toBeVisible();
  const title = 'Corso con retry';
  try {
    await page.getByRole('button', { name: 'Aggiungi al backlog', exact: true }).click();
    const form = page.getByRole('form', { name: 'Aggiungi al backlog' });
    await form.getByRole('textbox', { name: 'Titolo', exact: true }).fill(title);
    await form.getByRole('textbox', { name: 'Note', exact: true }).fill('Questa nota resta.');
    await page.route('**/trpc/study.saveBacklog*', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'Unavailable', code: -32603 } }),
      }),
    );
    await form.getByRole('button', { name: 'Salva', exact: true }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    await expect(form.getByRole('textbox', { name: 'Note', exact: true })).toHaveValue('Questa nota resta.');
    await page.unroute('**/trpc/study.saveBacklog*');
    await form.getByRole('button', { name: 'Salva', exact: true }).click();
    await expect(page.getByRole('listitem', { name: title })).toBeVisible();
  } finally {
    const entries: { id: string; title: string }[] = (await (await pc.get('/trpc/study.backlog')).json()).result.data;
    for (const item of entries.filter((entry) => entry.title === title))
      await pc.post('/trpc/study.deleteBacklog', { data: { id: item.id, confirmed: true } });
  }
});

test('backlog shows loading without an empty-state flash and supports keyboard creation', async ({ page, pc }) => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/trpc/*study.backlog*', async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await page.goto('/desk/studio?tab=backlog');
    await expect(page.getByRole('status', { name: 'Caricamento' })).toBeVisible();
    await expect(page.getByText('Nessun argomento nel backlog')).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByRole('status', { name: 'Caricamento' })).toHaveCount(0);
  const title = 'Argomento da tastiera';
  try {
    const add = page.getByRole('button', { name: 'Aggiungi al backlog', exact: true });
    await add.focus();
    await page.keyboard.press('Enter');
    const input = page.getByRole('textbox', { name: 'Titolo', exact: true });
    await input.focus();
    await page.keyboard.type(title);
    await page.getByRole('button', { name: 'Salva', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listitem', { name: title })).toBeVisible();
  } finally {
    const entries: { id: string; title: string }[] = (await (await pc.get('/trpc/study.backlog')).json()).result.data;
    for (const item of entries.filter((entry) => entry.title === title))
      await pc.post('/trpc/study.deleteBacklog', { data: { id: item.id, confirmed: true } });
  }
});
