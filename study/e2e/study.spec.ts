import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '../../../apps/e2e/tests/fixtures.ts';
import { PC_URL, RUN_TMP } from '../../../apps/e2e/tests/hosts.ts';

test('activates a plan and opens its days in place', async ({ page }) => {
  const inbox = join(RUN_TMP, 'study', 'in-arrivo');
  await mkdir(inbox, { recursive: true });
  await page.goto(`${PC_URL}/desk/studio?tab=piani`);
  await expect(page.getByText('Nuovo piano trovato')).not.toBeVisible();
  await copyFile(new URL('../fixtures/example.json', import.meta.url), join(inbox, 'example.json'));
  await expect(page.getByText('Nuovo piano trovato')).toBeVisible();
  await page.getByRole('button', { name: 'Attiva' }).click();
  await expect(page.getByRole('heading', { name: 'Piano di esempio', level: 2 })).toBeVisible();
  const hours = page.getByRole('spinbutton', { name: 'Ore a settimana' });
  expect((await hours.boundingBox())?.width).toBeGreaterThan(200);
  await page.getByRole('tab', { name: 'Piano', exact: true }).click();
  const leaf = page.getByRole('button', { name: 'G1 · La foglia' });
  await expect(leaf).toBeVisible();
  // The group holding the current day starts open, the others closed; the current day starts open in place.
  await expect(page.getByRole('button', { name: /^Settimana 1 ·/ })).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: /^Settimana 2 ·/ })).toHaveAttribute('aria-expanded', 'false');
  await expect(leaf).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Descrivi una foglia.')).toBeVisible();
  await leaf.click();
  await expect(page.getByText('Descrivi una foglia.')).not.toBeVisible();
  await page.getByRole('button', { name: 'G2 · Il cielo' }).click();
  await expect(page.getByText('Descrivi una stella.')).toBeVisible();
  // Read-only: no control to tick a step in Piano (ticking is step 41, in Oggi).
  await expect(page.getByRole('region', { name: 'Giorni del piano' }).getByRole('checkbox')).toHaveCount(0);
  const unfinished = page.getByRole('button', { name: 'Da finire' });
  await expect(unfinished).toHaveAttribute('aria-pressed', 'false');
  await unfinished.click();
  await expect(leaf).toBeVisible();
  const subjects = page.getByRole('group', { name: 'Materie' });
  await subjects.getByRole('button', { name: 'Astronomia' }).click();
  await expect(leaf).not.toBeVisible();
  await subjects.getByRole('button', { name: 'Tutte' }).click();
  await expect(page.getByRole('button', { name: 'G2 · Il cielo' })).toBeVisible();
  await page.getByRole('button', { name: /^Settimana 2 ·/ }).click();
  await expect(page.getByRole('button', { name: 'G3 · La radice' })).toBeVisible();
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  try {
    db.prepare('INSERT INTO progress (plan_id, kind, id, value) VALUES (?, ?, ?, ?)').run(
      'example',
      'day',
      'A01',
      'done',
    );
    await page.reload();
    await expect(page.getByRole('button', { name: 'G1 · La foglia' })).toBeVisible();
    await page.getByRole('button', { name: 'Da finire' }).click();
    await expect(page.getByRole('button', { name: 'G1 · La foglia' })).not.toBeVisible();
    await expect(page.getByRole('button', { name: 'G2 · Il cielo' })).toBeVisible();
  } finally {
    db.prepare('DELETE FROM progress WHERE plan_id = ? AND kind = ? AND id = ?').run('example', 'day', 'A01');
    db.close();
  }
});

test('a large plan loads only the first open group', async ({ page, pc }) => {
  const inbox = join(RUN_TMP, 'study', 'in-arrivo');
  await mkdir(inbox, { recursive: true });
  const plan = JSON.parse(await readFile(new URL('../fixtures/example.json', import.meta.url), 'utf8'));
  plan.days = Array.from({ length: 500 }, (_, i) => ({
    ...plan.days[0],
    id: `day-${i}`,
    recall: [],
    blocks: [
      {
        id: `block-${i}`,
        title: 'Studio',
        steps: Array.from({ length: 10 }, (_, n) => ({ id: `step-${i}-${n}`, text: 'Studia' })),
      },
    ],
  }));
  await writeFile(join(inbox, 'large.json'), JSON.stringify(plan));
  expect((await pc.post('/trpc/study.activate', { data: { name: 'large.json' } })).ok()).toBe(true);
  const calls: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('study.daysById')) calls.push(request.url());
  });
  await page.goto(`${PC_URL}/desk/studio?tab=piano`);
  await expect(page.getByRole('button', { name: 'G1 · La foglia' })).toBeVisible();
  // The group button comes from the plan summary; the days of its first open group are fetched right after, so wait
  // for that request (a build is fast enough to run the next line before it left) and then require it to be the only one.
  await expect.poll(() => calls.length).toBeGreaterThan(0);
  expect(calls).toHaveLength(1);
  expect(decodeURIComponent(calls[0] ?? '')).toContain('day-6');
  expect(decodeURIComponent(calls[0] ?? '')).not.toContain('day-7');
  await expect(page.getByRole('button', { name: /^Settimana 2 ·/ })).toHaveAttribute('aria-expanded', 'false');
});

test('a second plan is active next to the first, filters by plan and pauses from Piani', async ({ page }) => {
  const inbox = join(RUN_TMP, 'study', 'in-arrivo');
  await mkdir(inbox, { recursive: true });
  const base = JSON.parse(await readFile(new URL('../fixtures/example.json', import.meta.url), 'utf8'));
  await copyFile(new URL('../fixtures/example.json', import.meta.url), join(inbox, 'first.json'));
  // One subject, the same day ids as the first plan: days are told apart by plan (decision 15).
  const second = {
    ...base,
    id: 'second',
    title: 'Secondo corso',
    subjects: [{ id: 'a', name: 'Geologia' }],
    threads: [{ id: 'plants', subject: 'a', title: 'Rocce' }],
    phases: [],
    days: base.days.map((day: { id: string }) => ({
      ...day,
      subject: 'a',
      phase: undefined,
      threads: ['plants'],
      title: `Rocce ${day.id}`,
    })),
  };
  await writeFile(join(inbox, 'second.json'), JSON.stringify(second));
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  try {
    await page.goto(`${PC_URL}/desk/studio?tab=piani`);
    for (const name of ['Piano di esempio', 'Secondo corso']) {
      const found = page.getByRole('region', { name: 'Nuovo piano trovato' }).filter({ hasText: name });
      await found.getByRole('button', { name: 'Attiva' }).click();
      await expect(found).not.toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Piano di esempio' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Secondo corso' })).toBeVisible();
    await page.getByRole('tab', { name: 'Piano', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Piano · 2 piani' })).toBeVisible();
    const subjects = page.getByRole('group', { name: 'Materie' });
    await subjects.getByRole('button', { name: 'Secondo corso' }).click();
    await expect(page.getByRole('button', { name: /· Rocce A01$/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /· La foglia$/ })).not.toBeVisible();
    await page.getByRole('tab', { name: 'Materie', exact: true }).click();
    await page
      .getByRole('region', { name: 'Secondo corso' })
      .getByRole('button', { name: 'Metti in pausa il piano' })
      .click();
    const pausedPlans = page.getByRole('region', { name: 'Piani in pausa' });
    await expect(pausedPlans.getByText('Secondo corso')).toBeVisible();
    await pausedPlans.getByRole('button', { name: 'Riprendi' }).click();
    await expect(page.getByRole('heading', { name: 'Secondo corso' })).toBeVisible();
  } finally {
    for (const table of ['plans', 'progress', 'preferences'])
      db.prepare(`DELETE FROM ${table} WHERE ${table === 'plans' ? 'id' : 'plan_id'} IN ('second', '*')`).run();
    db.prepare("DELETE FROM days WHERE plan_id = 'second'").run();
    db.close();
  }
});

test('Oggi tracks steps, notes, autonomy and a chosen day without completing earlier work', async ({ page, pc }) => {
  const inbox = join(RUN_TMP, 'study', 'in-arrivo');
  await mkdir(inbox, { recursive: true });
  await copyFile(new URL('../fixtures/example.json', import.meta.url), join(inbox, 'today.json'));
  expect((await pc.post('/trpc/study.activate', { data: { name: 'today.json' } })).ok()).toBe(true);
  await page.goto(`${PC_URL}/desk/studio?tab=piano`);
  await page.getByRole('button', { name: 'G2 · Il cielo' }).click();
  await page.getByRole('button', { name: 'Imposta come corrente' }).last().click();
  await page.getByRole('tab', { name: 'Oggi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Il cielo' })).toBeVisible();
  await page.getByRole('button', { name: 'Stelle: Da valutare' }).click();
  await page.getByRole('option', { name: 'Verde' }).click();
  const tick = page.getByRole('checkbox', { name: 'Descrivi una stella.' });
  await tick.check();
  await expect(tick).toBeChecked();
  await expect(page.getByRole('button', { name: 'Stelle: Verde' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Note' }).fill('Nota di esempio');
  await page.getByRole('textbox', { name: 'Note' }).blur();
  await expect(page.getByText('Salvato')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'La foglia' })).toBeVisible();
  await page.getByRole('tab', { name: 'Piano', exact: true }).click();
  await expect(page.getByRole('button', { name: 'G1 · La foglia' })).toBeVisible();
  await page.getByRole('button', { name: 'Da finire' }).click();
  await expect(page.getByRole('button', { name: 'G2 · Il cielo' })).not.toBeVisible();
});

test('Oggi preserves a failed tick until retry and passed subjects can be resumed', async ({ page, pc }) => {
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  db.prepare("DELETE FROM progress WHERE plan_id IN ('example', '*')").run();
  db.close();
  const inbox = join(RUN_TMP, 'study', 'in-arrivo');
  await mkdir(inbox, { recursive: true });
  await copyFile(new URL('../fixtures/example.json', import.meta.url), join(inbox, 'retry.json'));
  expect((await pc.post('/trpc/study.activate', { data: { name: 'retry.json' } })).ok()).toBe(true);
  await page.goto(`${PC_URL}/desk/studio`);
  await expect(page.getByRole('heading', { name: 'La foglia' })).toBeVisible();
  await page.route('**/trpc/study.setStep*', async (route) => {
    await route.abort();
  });
  const tick = page.getByRole('checkbox', { name: 'Descrivi una foglia.' });
  await tick.check();
  await expect(page.getByRole('alert')).toContainText('Salvataggio non riuscito');
  await expect(tick).toBeChecked();
  await page.unroute('**/trpc/study.setStep*');
  await page.getByRole('button', { name: 'Riprova' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  const state = page.getByRole('button', { name: 'Materia: In corso' });
  await expect(state).toContainText('Materia');
  await expect(state).toContainText('In corso');
  await state.click();
  await page.getByRole('option', { name: 'Superato' }).click();
  await expect(page.getByRole('heading', { name: 'Il cielo' })).toBeVisible();
  await page.getByRole('tab', { name: 'Materie', exact: true }).click();
  await page.getByRole('button', { name: 'Riprendi' }).click();
  await expect(page.getByRole('button', { name: 'Segna superato' }).first()).toBeVisible();
  await page.getByRole('tab', { name: 'Piano', exact: true }).click();
  await page.getByRole('button', { name: /^Settimana 2 ·/ }).click();
  await expect(page.getByRole('button', { name: /La radice$/ })).toBeVisible();
});

test('Oggi keeps a failed note through navigation and saves it on retry', async ({ page }) => {
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  db.prepare("DELETE FROM progress WHERE plan_id IN ('example', '*')").run();
  db.close();
  await page.goto(`${PC_URL}/desk/studio`);
  await expect(page.getByRole('heading', { name: 'La foglia' })).toBeVisible();
  await page.route('**/trpc/study.setNote*', (route) => route.abort());
  await page.getByRole('textbox', { name: 'Note' }).fill('Nota conservata');
  await page.getByRole('textbox', { name: 'Note' }).blur();
  await expect(page.getByRole('alert')).toContainText('Salvataggio non riuscito');
  await page.getByRole('tab', { name: 'Piano', exact: true }).click();
  await page.getByRole('tab', { name: 'Oggi', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('Nota conservata');
  await page.unroute('**/trpc/study.setNote*');
  await page.getByRole('button', { name: 'Riprova' }).click();
  await expect(page.getByText('Salvato')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Note' })).toHaveValue('Nota conservata');
});

test('pausing a subject renumbers Oggi and Piano and completing today offers the next day', async ({ page }) => {
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  db.prepare("DELETE FROM progress WHERE plan_id IN ('example', '*')").run();
  db.prepare("DELETE FROM preferences WHERE plan_id = '*'").run();
  db.close();
  await page.goto(`${PC_URL}/desk/studio`);
  await expect(page.getByRole('heading', { name: 'La foglia' })).toBeVisible();
  await page.getByRole('tab', { name: 'Materie', exact: true }).click();
  const astronomy = page.getByRole('listitem').filter({ hasText: 'Astronomia' });
  await astronomy.getByRole('button', { name: 'Metti in pausa' }).click();
  await page.getByRole('tab', { name: 'Oggi', exact: true }).click();
  await expect(page.getByText('G2 · La radice')).toBeVisible();
  await page.getByRole('tab', { name: 'Piano', exact: true }).click();
  await page.getByRole('button', { name: /^Settimana 2 ·/ }).click();
  await expect(page.getByRole('button', { name: 'G2 · La radice' })).toBeVisible();
  await page.getByRole('tab', { name: 'Oggi', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Descrivi una foglia.' }).check();
  await page.getByRole('button', { name: 'Vai alla prossima G' }).click();
  await expect(page.getByRole('heading', { name: 'La radice' })).toBeVisible();
  await expect(page.getByText(/in ritardo|giorni trascorsi/i)).toHaveCount(0);
});

test('mix reorders next days while weekly hours update estimates and preserve today', async ({ page, pc }) => {
  const inbox = join(RUN_TMP, 'study', 'in-arrivo');
  const plan = JSON.parse(await readFile(new URL('../fixtures/example.json', import.meta.url), 'utf8'));
  plan.days.push(
    ...['B02', 'B03'].map((id) => ({
      ...plan.days[1],
      id,
      title: `Stelle ${id}`,
      blocks: [{ id: `${id}.m`, title: 'Studio', steps: [{ id: `${id}.s`, text: 'Studia le stelle' }] }],
    })),
  );
  await writeFile(join(inbox, 'mix.json'), JSON.stringify(plan));
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  db.prepare("DELETE FROM progress WHERE plan_id IN ('example', '*')").run();
  db.prepare("DELETE FROM preferences WHERE plan_id = '*'").run();
  db.close();
  expect((await pc.post('/trpc/study.activate', { data: { name: 'mix.json' } })).ok()).toBe(true);
  await page.goto(`${PC_URL}/desk/studio`);
  await expect(page.getByText('G3 · La radice')).toBeVisible();
  await page.goto(`${PC_URL}/desk/studio?tab=piani`);
  await page.getByRole('spinbutton', { name: 'Ore a settimana' }).fill('4');
  await page.getByRole('spinbutton', { name: 'Botanica · Quota %' }).fill('20');
  await page.getByRole('spinbutton', { name: 'Astronomia · Quota %' }).fill('80');
  await page.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByText('80% · 3,2 ore a settimana')).toBeVisible();
  await page.getByRole('tab', { name: 'Oggi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'La foglia' })).toBeVisible();
  await expect(page.getByText('G3 · Stelle B02')).toBeVisible();
  await page.getByRole('tab', { name: 'Materie', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Ore a settimana' }).fill('8');
  await page.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(page.getByText('80% · 6,4 ore a settimana')).toBeVisible();
  await page.getByRole('tab', { name: 'Oggi', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'La foglia' })).toBeVisible();
  await expect(page.getByText('G3 · Stelle B02')).toBeVisible();
});

test('Ripasso lists threads, half days, open steps and errors, and ticking there updates Oggi', async ({
  page,
  pc,
}) => {
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  const inbox = join(RUN_TMP, 'study', 'in-arrivo');
  await mkdir(inbox, { recursive: true });
  const plan = JSON.parse(await readFile(new URL('../fixtures/example.json', import.meta.url), 'utf8'));
  plan.days[0].blocks[0].steps.push(
    { id: 'A01.m.2', text: 'Disegna una foglia.', file: { path: 'dispensa.pdf', page: 4 } },
    { id: 'A01.m.3', text: 'Nomina le parti.' },
  );
  await writeFile(join(inbox, 'review.json'), JSON.stringify(plan));
  try {
    db.prepare("DELETE FROM progress WHERE plan_id IN ('example', '*')").run();
    db.prepare("DELETE FROM preferences WHERE plan_id = '*'").run();
    expect((await pc.post('/trpc/study.activate', { data: { name: 'review.json' } })).ok()).toBe(true);
    await page.goto(`${PC_URL}/desk/studio?tab=ripasso`);
    await expect(page.getByRole('heading', { name: 'Niente da riprendere' })).toBeVisible();
    await pc.post('/trpc/study.setAutonomy', { data: { plan: 'example', id: 'plants', value: 'red' } });
    await pc.post('/trpc/study.setAutonomy', { data: { plan: 'example', id: 'stars', value: 'yellow' } });
    await pc.post('/trpc/study.setStep', { data: { key: 'example/A01', id: 'A01.m.1', done: true } });

    // An error entry from a step: the reference starts from the step's file and page, only reference and cause are needed.
    await page.getByRole('tab', { name: 'Oggi', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'La foglia' })).toBeVisible();
    await page.getByRole('button', { name: 'Registra un errore su: Disegna una foglia.' }).click();
    const form = page.getByRole('form', { name: 'Registra un errore' });
    await expect(form.getByRole('textbox', { name: 'Riferimento' })).toHaveValue('dispensa.pdf, p. 4');
    await form.getByRole('textbox', { name: 'Riferimento' }).fill('Foglio 1, es. 3');
    await expect(form.getByRole('button', { name: 'Salva errore' })).toBeDisabled();
    await form.getByRole('button', { name: /^Causa/ }).click();
    await page.getByRole('option', { name: 'Calcolo' }).click();
    await form.getByRole('button', { name: 'Salva errore' }).click();
    await expect(page.getByText('Errori: Foglio 1, es. 3 · Calcolo')).toBeVisible();

    await page.getByRole('tab', { name: 'Ripasso', exact: true }).click();
    await expect(page.getByText('4 da riprendere')).toBeVisible();
    const threads = page.getByRole('region', { name: 'Argomenti da riprendere' });
    await expect(threads.getByText('Piante')).toBeVisible();
    await expect(threads.getByText('Rosso')).toBeVisible();
    await expect(threads.getByText('Stelle')).toBeVisible();
    await expect(threads.getByText('Giallo')).toBeVisible();
    const half = page.getByRole('region', { name: 'Giorni a metà' });
    await expect(half.getByText('La foglia')).toBeVisible();
    await expect(half.getByText('2 di 3 passi ancora da fare')).toBeVisible();
    const errors = page.getByRole('region', { name: 'Errori da riprovare' });
    await expect(errors.getByText('Foglio 1, es. 3')).toBeVisible();
    await expect(page.getByText(/in ritardo|giorni trascorsi|scadut/i)).toHaveCount(0);

    // Filters.
    await page.getByRole('button', { name: 'Giallo', exact: true }).click();
    await expect(threads.getByText('Piante')).not.toBeVisible();
    await expect(threads.getByText('Stelle')).toBeVisible();
    await expect(half).not.toBeVisible();
    await page.getByRole('button', { name: 'Tutte', exact: true }).click();

    // A failed tick says so and keeps the step in the list.
    await page.route('**/trpc/study.setStep*', (route) => route.abort());
    await page.getByRole('checkbox', { name: 'Disegna una foglia.' }).click();
    await expect(page.getByRole('alert')).toContainText('Salvataggio non riuscito');
    await expect(page.getByRole('checkbox', { name: 'Disegna una foglia.' })).toHaveCount(1);
    await page.unroute('**/trpc/study.setStep*');

    // Ticking a carried step updates Oggi.
    // The row leaves the list once saved, so the checkbox cannot hold the new state: click, do not check.
    await page.getByRole('checkbox', { name: 'Disegna una foglia.' }).click();
    await expect(page.getByRole('checkbox', { name: 'Disegna una foglia.' })).toHaveCount(0);
    await expect(half.getByText('1 di 3 passi ancora da fare')).toBeVisible();
    await page.getByRole('tab', { name: 'Oggi', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Disegna una foglia.' })).toBeChecked();

    // Editing: solving an entry takes it out of the retry list.
    await page.getByRole('tab', { name: 'Ripasso', exact: true }).click();
    await errors.getByRole('button', { name: 'Modifica: Foglio 1, es. 3' }).click();
    const edit = errors.getByRole('form', { name: 'Registra un errore' });
    await edit.getByRole('textbox', { name: 'Cosa ho provato' }).fill('Ho diviso per due');
    await edit.getByRole('button', { name: /^Giorno per riprovare/ }).click();
    await page.getByRole('option', { name: 'G2 · Il cielo' }).click();
    await edit.getByRole('button', { name: 'Salva errore' }).click();
    await expect(edit).not.toBeVisible();
    await expect(errors.getByText('Ho diviso per due')).toBeVisible();
    await expect(errors.getByText(/Da riprovare in G2/)).toBeVisible();
    await errors.getByRole('button', { name: 'Modifica: Foglio 1, es. 3' }).click();
    await errors.getByRole('button', { name: /^Risultato/ }).click();
    await page.getByRole('option', { name: 'Risolto senza aiuto' }).click();
    await errors.getByRole('button', { name: 'Salva errore' }).click();
    await expect(errors.getByText('Foglio 1, es. 3')).not.toBeVisible();
    await expect(page.getByText('1 risolti senza aiuto')).toBeVisible();

    // Recall in Oggi shows the errors of the recalled day, solved or not.
    await pc.post('/trpc/study.setCurrent', { data: { key: 'example/A02' } });
    await page.getByRole('tab', { name: 'Oggi', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'La radice' })).toBeVisible();
    await expect(page.getByText('Errori: Foglio 1, es. 3 · Calcolo')).toBeVisible();

    // Each thread links to its day.
    await page.getByRole('tab', { name: 'Ripasso', exact: true }).click();
    await threads.getByRole('button', { name: 'Apri G1' }).first().click();
    await expect(page.getByRole('heading', { name: 'La foglia' })).toBeVisible();
  } finally {
    db.prepare("DELETE FROM progress WHERE plan_id IN ('example', '*')").run();
    db.close();
  }
});

test('the Studio tab bar names what each tab holds, and an old Materie link still opens it', async ({ page }) => {
  await page.goto(`${PC_URL}/desk/studio`);
  await expect(page.getByRole('tab').first()).toBeVisible();
  await expect(page.getByRole('tab')).toHaveText(['Oggi', 'Piano', 'Ripasso', 'Libreria', 'Materie']);
  await page.goto(`${PC_URL}/desk/studio?tab=piani`);
  await expect(page.getByRole('tab', { name: 'Materie', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('revisiting a clean note adopts another client text before the next edit', async ({ page, pc }) => {
  const inbox = join(RUN_TMP, 'study', 'in-arrivo');
  await mkdir(inbox, { recursive: true });
  await copyFile(new URL('../fixtures/example.json', import.meta.url), join(inbox, 'note.json'));
  expect((await pc.post('/trpc/study.activate', { data: { name: 'note.json' } })).ok()).toBe(true);
  const db = new DatabaseSync(join(RUN_TMP, 'modules', 'study.db'));
  db.prepare("DELETE FROM progress WHERE plan_id IN ('example', '*')").run();
  db.prepare("DELETE FROM preferences WHERE plan_id = '*'").run();
  db.close();
  await page.goto(`${PC_URL}/desk/studio`);
  await expect(page.getByRole('heading', { name: 'La foglia' })).toBeVisible();
  const note = page.getByRole('textbox', { name: 'Note' });
  await note.fill('Prima nota');
  await note.blur();
  await expect(page.getByText('Salvato')).toBeVisible();
  expect((await pc.post('/trpc/study.setNote', { data: { key: 'example/A01', text: 'Da altro client' } })).ok()).toBe(
    true,
  );
  await page.getByRole('tab', { name: 'Piano', exact: true }).click();
  await page.getByRole('tab', { name: 'Oggi', exact: true }).click();
  await expect(note).toHaveValue('Da altro client');
  await note.fill('Da altro client, con aggiunta');
  await note.blur();
  await expect(page.getByText('Salvato')).toBeVisible();
  await page.reload();
  await expect(note).toHaveValue('Da altro client, con aggiunta');
});
