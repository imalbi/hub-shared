import { copyFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, test, type APIRequestContext } from '../../../apps/e2e/tests/fixtures.ts';
import { PC_URL, RUN_TMP } from '../../../apps/e2e/tests/hosts.ts';

const scope = { planId: 'example', subjectId: 'a' };
type Resource = { id: string; revision: number; title: string; body: string; pinned: boolean };
async function entries(pc: APIRequestContext): Promise<Resource[]> {
  return (await (await pc.get('/trpc/study.resources', { params: { input: JSON.stringify(scope) } })).json()).result
    .data;
}
async function seed(pc: APIRequestContext, title: string, body = 'Testo iniziale', pinned = false): Promise<Resource> {
  const response = await pc.post('/trpc/study.saveResource', { data: { ...scope, kind: 'note', title, body, pinned } });
  expect(response.ok()).toBe(true);
  return (await response.json()).result.data;
}

test.beforeAll(async ({ request }) => {
  const inbox = join(RUN_TMP, 'study', 'in-arrivo');
  await mkdir(inbox, { recursive: true });
  await copyFile(new URL('../fixtures/example.json', import.meta.url), join(inbox, 'resources.json'));
  expect((await request.post(`${PC_URL}/trpc/study.activate`, { data: { name: 'resources.json' } })).ok()).toBe(true);
});

test.afterEach(async ({ pc }) => {
  for (const row of await entries(pc))
    await pc.post('/trpc/study.deleteResource', { data: { id: row.id, revision: row.revision, confirmed: true } });
});

for (const width of [3840, 375]) {
  test(`resources create, pin, navigate, retain drafts and delete at ${width}px`, async ({ page, pc }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 2160 });
    await page.goto('/desk/studio?tab=libreria&subject=example:a');
    const refs = page.getByRole('region', { name: 'Riferimenti', exact: true });
    const pdfs = page.getByRole('region', { name: 'Libreria', exact: true });
    await refs.getByRole('button', { name: 'Nuovo appunto', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Nuovo appunto', exact: true });
    await dialog.getByRole('textbox', { name: 'Titolo', exact: true }).fill('Scheda foglia');
    await dialog
      .getByRole('textbox', { name: 'Testo', exact: true })
      .fill(
        '# Foglia\n\n- Lembo\n- Picciolo\n\n| Parte | Funzione |\n| --- | --- |\n| Lembo | Luce |\n\n[Sito](https://example.com) [Vietato](javascript:alert%281%29)\n\n<script>alert(1)</script>',
      );
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
    await expect(refs.locator('span').filter({ hasText: /^Non salvato$/ })).toBeVisible();
    const newNote = refs.getByRole('button', { name: 'Nuovo appunto', exact: true });
    await newNote.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('textbox', { name: 'Titolo', exact: true })).toHaveValue('Scheda foglia');
    await expect(dialog.getByRole('textbox', { name: 'Testo', exact: true })).toHaveValue(/# Foglia/);
    await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    let row = refs.getByRole('listitem', { name: 'Scheda foglia', exact: true });
    await expect(row).toBeVisible();
    expect((await entries(pc))[0]?.pinned).toBe(false);
    await row.getByRole('button', { name: 'Apri, Scheda foglia', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Scheda foglia', exact: true });
    await expect(dialog.getByRole('heading', { name: 'Foglia', exact: true })).toBeVisible();
    await expect(dialog.getByRole('listitem')).toHaveCount(2);
    await expect(dialog.getByRole('table')).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Sito', exact: true })).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(dialog.getByRole('link', { name: 'Vietato', exact: true })).toHaveCount(0);
    await expect(dialog.locator('script')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Modifica', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Testo', exact: true }).fill('Bozza conservata');
    await page.keyboard.press('Escape');
    await expect(row.locator('span').filter({ hasText: /^Non salvato$/ })).toBeVisible();
    await row.getByRole('button', { name: 'Apri, Scheda foglia', exact: true }).click();
    await dialog.getByRole('button', { name: 'Modifica', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Testo', exact: true })).toHaveValue('Bozza conservata');
    await dialog.getByRole('button', { name: 'Scarta', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Testo', exact: true })).toHaveValue(/# Foglia/);
    await page.keyboard.press('Escape');
    await row.getByRole('button', { name: 'Fissa', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Rimuovi dai fissati', exact: true })).toBeVisible();
    if (width === 3840) {
      await page.getByRole('tab', { name: 'Oggi', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Materiali utili', exact: true })).toBeVisible();
      await expect(page.getByRole('listitem', { name: 'Scheda foglia', exact: true })).toBeVisible();
      await page.getByRole('link', { name: 'Gestisci materiali', exact: true }).click();
      await expect(page).toHaveURL(/subject=example%3Aa/);
    }
    await pdfs.getByRole('button', { name: 'Fissa', exact: true }).click();
    const pdfDialog = page.getByRole('dialog', { name: 'Fissa', exact: true });
    await expect(pdfDialog.getByRole('textbox', { name: 'Titolo', exact: true })).toHaveValue('dispensa.pdf');
    await pdfDialog.getByRole('spinbutton').fill('2');
    await pdfDialog.getByRole('button', { name: 'Salva', exact: true }).click();
    await expect(refs.getByRole('listitem', { name: 'dispensa.pdf', exact: true })).toBeVisible();
    await refs.getByRole('button', { name: 'Aggiungi link', exact: true }).click();
    const linkDialog = page.getByRole('dialog', { name: 'Aggiungi link', exact: true });
    await linkDialog.getByRole('textbox', { name: 'Titolo', exact: true }).fill('Sito botanica');
    await linkDialog.getByRole('textbox', { name: 'Link', exact: true }).fill('https://example.com/plants');
    await linkDialog.getByRole('button', { name: 'Salva', exact: true }).click();
    await expect(refs.getByRole('listitem', { name: 'Sito botanica', exact: true }).getByRole('link')).toHaveAttribute(
      'target',
      '_blank',
    );
    await page.reload();
    row = refs.getByRole('listitem', { name: 'Scheda foglia', exact: true });
    await row.getByRole('button', { name: 'Elimina', exact: true }).click();
    const deletion = page.getByRole('dialog', { name: 'Elimina materiale?', exact: true });
    await deletion.getByRole('button', { name: 'Annulla', exact: true }).click();
    await expect(deletion).not.toBeVisible();
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Elimina', exact: true }).click();
    await deletion.getByRole('button', { name: 'Elimina', exact: true }).click();
    await expect(row).toHaveCount(0);
    const left = (await refs.boundingBox())!;
    const right = (await pdfs.boundingBox())!;
    expect(width === 375 ? right.y >= left.y + left.height : right.x >= left.x + left.width).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('failed saves retain text; both conflict choices use the latest revision', async ({ page, pc }) => {
  const original = await seed(pc, 'Appunto concorrente');
  await page.goto('/desk/studio?tab=libreria&subject=example:a');
  const row = page.getByRole('listitem', { name: original.title, exact: true });
  await row.getByRole('button', { name: `Apri, ${original.title}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: original.title, exact: true });
  await dialog.getByRole('button', { name: 'Modifica', exact: true }).click();
  const text = dialog.getByRole('textbox', { name: 'Testo', exact: true });
  await text.fill('Bozza locale');
  await page.route('**/trpc/study.saveResource*', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Unavailable', code: -32603 } }),
    }),
  );
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(text).toHaveValue('Bozza locale');
  await page.unroute('**/trpc/study.saveResource*');
  await dialog.getByRole('button', { name: 'Riprova', exact: true }).click();
  await expect(dialog.getByText('Salvato', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Modifica', exact: true }).click();
  await text.fill('Bozza dopo conflitto');
  let current = (await entries(pc))[0];
  expect(
    (
      await pc.post('/trpc/study.saveResource', {
        data: {
          ...scope,
          id: current.id,
          revision: current.revision,
          title: current.title,
          kind: 'note',
          body: 'Versione agente',
        },
      })
    ).ok(),
  ).toBe(true);
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Ricarica dal server', exact: true })).toBeVisible();
  await expect(text).toHaveValue('Bozza dopo conflitto');
  await dialog.getByRole('button', { name: 'Ricarica dal server', exact: true }).click();
  await expect(text).toHaveValue('Versione agente');
  await text.fill('Versione voluta');
  current = (await entries(pc))[0];
  await pc.post('/trpc/study.saveResource', {
    data: {
      ...scope,
      id: current.id,
      revision: current.revision,
      title: current.title,
      kind: 'note',
      body: 'Altro aggiornamento agente',
    },
  });
  await dialog.getByRole('button', { name: 'Salva', exact: true }).click();
  await dialog.getByRole('button', { name: 'Sovrascrivi comunque', exact: true }).click();
  await expect(dialog.getByText('Salvato', { exact: true })).toBeVisible();
  expect((await entries(pc))[0]?.body).toBe('Versione voluta');
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(row.locator('span').filter({ hasText: /^Non salvato$/ })).toHaveCount(0);
  await row.getByRole('button', { name: `Apri, ${original.title}`, exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Salvato', { exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('opening Libreria without a subject param preselects the current Oggi subject', async ({ page, pc }) => {
  const previous: string = (await (await pc.get('/trpc/study.index')).json()).result.data.current;
  expect((await pc.post('/trpc/study.setCurrent', { data: { key: 'example/B01' } })).ok()).toBe(true);
  try {
    await page.goto('/desk/studio?tab=libreria');
    await expect(page.getByRole('button', { name: /Materia:.*Astronomia/ })).toBeVisible();
  } finally {
    await pc.post('/trpc/study.setCurrent', { data: { key: previous } });
  }
});

test('query failure retries and explicit subject selection isolates references', async ({ page, pc }) => {
  await seed(pc, 'Solo botanica', 'Testo', true);
  await page.route('**/trpc/*study.resources*', (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { message: 'Unavailable', code: -32603 } }),
    }),
  );
  await page.goto('/desk/studio?tab=libreria&subject=example:a');
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 15000 });
  await page.unroute('**/trpc/*study.resources*');
  await page.getByRole('button', { name: 'Riprova', exact: true }).click();
  await expect(page.getByRole('listitem', { name: 'Solo botanica', exact: true })).toBeVisible();
  await page.goto('/desk/studio?tab=libreria&subject=example:b');
  await expect(page.getByRole('listitem', { name: 'Solo botanica', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Materia:.*Astronomia/ })).toBeVisible();
});
