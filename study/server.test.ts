import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../../apps/server/src/db/index.ts';
import { emptyConfig } from '../../apps/server/src/core/config.ts';
import { buildServer } from './test-server.ts';
import { createFakeDesktop } from '../../apps/server/src/testing/fake-desktop.ts';
import { readPlan } from './inbox.ts';
import { planSchema } from './plan.ts';
import { savePlan } from './store.ts';

process.env.NODE_ENV = 'test';

void test('reads a folder plan in chunk name order', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-test-'));
  try {
    const source = planSchema.parse(
      JSON.parse(await readFile(new URL('./fixtures/example.json', import.meta.url), 'utf8')),
    );
    const { days, ...header } = source;
    await mkdir(join(dir, 'folder'));
    await writeFile(join(dir, 'single.json'), JSON.stringify(source));
    await writeFile(join(dir, 'folder', 'plan.json'), JSON.stringify(header));
    await Promise.all(
      days.map((day: unknown, index: number) =>
        writeFile(join(dir, 'folder', `days-0${index}.json`), JSON.stringify([day])),
      ),
    );
    assert.deepEqual(await readPlan(join(dir, 'folder')), await readPlan(join(dir, 'single.json')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

void test('inbox reports plans and activation archives a valid file', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'study-test-'));
  await mkdir(join(dir, 'in-arrivo'));
  await writeFile(
    join(dir, 'in-arrivo', 'example.json'),
    await readFile(new URL('./fixtures/example.json', import.meta.url)),
  );
  await writeFile(join(dir, 'in-arrivo', 'broken.json'), '{}');
  await mkdir(join(dir, 'in-arrivo', 'broken-folder'));
  const source = JSON.parse(await readFile(new URL('./fixtures/example.json', import.meta.url), 'utf8'));
  const { days, ...header } = source;
  await writeFile(join(dir, 'in-arrivo', 'unsafe.json'), JSON.stringify({ ...source, id: 'a/b' }));
  await writeFile(join(dir, 'in-arrivo', 'broken-folder', 'plan.json'), JSON.stringify(header));
  await writeFile(
    join(dir, 'in-arrivo', 'broken-folder', 'days-01.json'),
    JSON.stringify([{ ...days[0], phase: 'missing' }]),
  );
  await mkdir(join(dir, 'in-arrivo', 'unreadable'));
  await writeFile(join(dir, 'in-arrivo', 'unreadable', 'plan.json'), JSON.stringify(header));
  await writeFile(join(dir, 'in-arrivo', 'unreadable', 'days-01.json'), '{');
  await writeFile(
    join(dir, 'in-arrivo', 'many.json'),
    JSON.stringify({
      ...source,
      days: Array.from({ length: 60 }, (_, i) => ({ ...days[0], id: `d${i}`, phase: 'missing', blocks: [] })),
    }),
  );
  const app = buildServer({
    dbPath: ':memory:',
    deps: { run: createFakeDesktop() },
    config: { ...emptyConfig, modules: { study: { plansDir: dir, materialDirs: [] } } },
  });
  // Server first, then the folder: hooks run in registration order, and removing the folder while the state
  // writer still wrote to it failed with ENOTEMPTY under load.
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const inbox = (await app.inject('/trpc/study.inbox')).json().result.data;
  const unsafe = inbox.find((entry: { name: string }) => entry.name === 'unsafe.json');
  assert.equal(unsafe.valid, false);
  assert.ok(unsafe.issues.some((issue: { path: string }) => issue.path === 'id'));
  assert.notEqual(
    (await app.inject({ method: 'POST', url: '/trpc/study.activate', payload: { name: 'unsafe.json' } })).statusCode,
    200,
  );
  const found = inbox.find((entry: { name: string }) => entry.name === 'example.json');
  assert.equal(found?.valid, true);
  // Piani previews a found plan without activating it: its size and first day titles.
  assert.equal(found?.days, 3);
  assert.deepEqual(found?.preview.slice(0, 2), ['La foglia', 'Il cielo']);
  assert.equal(inbox.find((entry: { name: string }) => entry.name === 'broken.json')?.valid, false);
  const broken = inbox.find((entry: { name: string }) => entry.name === 'broken-folder');
  assert.ok(
    broken.issues.some(
      (issue: { file: string; path: string }) => issue.file === 'days-01.json' && issue.path === '0.phase',
    ),
  );
  assert.equal(inbox.find((entry: { name: string }) => entry.name === 'unreadable').issues[0].file, 'days-01.json');
  const many = inbox.find((entry: { name: string }) => entry.name === 'many.json');
  assert.equal(many.issues.length, 50);
  assert.equal(many.remainingIssues, 10);
  assert.notEqual(
    (await app.inject({ method: 'POST', url: '/trpc/study.activate', payload: { name: 'broken.json' } })).statusCode,
    200,
  );
  const response = await app.inject({ method: 'POST', url: '/trpc/study.activate', payload: { name: 'example.json' } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(
    (await app.inject('/trpc/study.active')).json().result.data.map((plan: { id: string }) => plan.id),
    ['example'],
  );
  const page = await app.inject('/trpc/study.days?input=%7B%22offset%22%3A0%2C%22limit%22%3A1%7D');
  assert.equal(page.json().result.data.length, 1);
  assert.equal(page.json().result.data[0].id, 'A01');
  const paused = await app.inject({
    method: 'POST',
    url: '/trpc/study.setSubject',
    payload: { plan: 'example', id: 'b', state: 'paused' },
  });
  assert.equal(paused.statusCode, 200);
  const index = (await app.inject('/trpc/study.index')).json().result.data;
  assert.deepEqual(
    index.days.map((day: { id: string; g: number }) => [day.id, day.g]),
    [
      ['A01', 1],
      ['A02', 2],
    ],
  );
  assert.ok(await readFile(join(dir, 'archivio', 'example.json')));
  const original = await readFile(join(dir, 'archivio', 'example.json'), 'utf8');
  await writeFile(join(dir, 'in-arrivo', 'example.json'), original);
  assert.equal(
    (await app.inject({ method: 'POST', url: '/trpc/study.activate', payload: { name: 'example.json' } })).statusCode,
    200,
  );
  assert.equal(await readFile(join(dir, 'archivio', 'example.json'), 'utf8'), original);
  assert.equal((await readdir(join(dir, 'archivio'))).length, 2);
});

void test('revisions retain progress, including ids no longer present', async () => {
  const db = openDatabase(':memory:', fileURLToPath(new URL('./drizzle', import.meta.url)));
  try {
    const plan = planSchema.parse(
      JSON.parse(await readFile(new URL('./fixtures/example.json', import.meta.url), 'utf8')),
    );
    savePlan(db, plan);
    db.$client
      .prepare('INSERT INTO progress (plan_id, kind, id, value) VALUES (?, ?, ?, ?)')
      .run(plan.id, 'step', 'old', 'done');
    savePlan(db, { ...plan, version: 2, days: plan.days.slice(0, 1) });
    assert.equal(db.$client.prepare('SELECT value FROM progress WHERE id = ?').get('old')?.value, 'done');
  } finally {
    db.$client.close();
  }
});

void test('activating a revision preserves kept and removed progress', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'study-test-'));
  await mkdir(join(dir, 'in-arrivo'));
  const plan = planSchema.parse(
    JSON.parse(await readFile(new URL('./fixtures/example.json', import.meta.url), 'utf8')),
  );
  await writeFile(join(dir, 'in-arrivo', 'first.json'), JSON.stringify(plan));
  const app = buildServer({
    dbPath: join(dir, 'hub.db'),
    deps: { run: createFakeDesktop() },
    config: { ...emptyConfig, modules: { study: { plansDir: dir, materialDirs: [] } } },
  });
  // Server first, then the folder: hooks run in registration order, and removing the folder while the state
  // writer still wrote to it failed with ENOTEMPTY under load.
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const activate = (name: string) => app.inject({ method: 'POST', url: '/trpc/study.activate', payload: { name } });
  assert.equal((await activate('first.json')).statusCode, 200);
  const db = new DatabaseSync(join(dir, 'modules', 'study.db'));
  try {
    const insert = db.prepare('INSERT INTO progress (plan_id, kind, id, value) VALUES (?, ?, ?, ?)');
    insert.run(plan.id, 'step', 'A01.m.1', 'done');
    insert.run(plan.id, 'step', 'A02.m.1', 'done');
    await writeFile(
      join(dir, 'in-arrivo', 'revision.json'),
      JSON.stringify({ ...plan, version: 2, days: plan.days.slice(0, 2) }),
    );
    assert.equal((await activate('revision.json')).statusCode, 200);
    assert.deepEqual(
      db
        .prepare('SELECT id, value FROM progress ORDER BY id')
        .all()
        .map((row) => [row.id, row.value]),
      [
        ['A01.m.1', 'done'],
        ['A02.m.1', 'done'],
      ],
    );
  } finally {
    db.close();
  }
});

void test('validates and stores 500 days with 5000 steps within two seconds', async () => {
  const db = openDatabase(':memory:', fileURLToPath(new URL('./drizzle', import.meta.url)));
  try {
    const source = planSchema.parse(
      JSON.parse(await readFile(new URL('./fixtures/example.json', import.meta.url), 'utf8')),
    );
    const day = source.days[0];
    if (!day) throw new Error('Missing fixture day');
    const large = {
      ...source,
      days: Array.from({ length: 500 }, (_, index) => ({
        ...day,
        id: `day-${index}`,
        recall: [],
        blocks: [
          {
            id: `block-${index}`,
            title: 'Studio',
            steps: Array.from({ length: 10 }, (_, n) => ({ id: `step-${index}-${n}`, text: 'Studia' })),
          },
        ],
      })),
    };
    const started = performance.now();
    savePlan(db, planSchema.parse(large));
    assert.ok(performance.now() - started < 2000);
    assert.equal(db.$client.prepare('SELECT count(*) AS n FROM days').get()?.n, 500);
  } finally {
    db.$client.close();
  }
});

void test('activates 500 days and 5000 steps within two seconds', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'study-test-'));
  await mkdir(join(dir, 'in-arrivo'));
  const plan = planSchema.parse(
    JSON.parse(await readFile(new URL('./fixtures/example.json', import.meta.url), 'utf8')),
  );
  const template = plan.days[0];
  if (!template) throw new Error('Missing fixture day');
  const days = Array.from({ length: 500 }, (_, i) => ({
    ...template,
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
  await writeFile(join(dir, 'in-arrivo', 'large.json'), JSON.stringify({ ...plan, days }));
  const app = buildServer({
    dbPath: ':memory:',
    deps: { run: createFakeDesktop() },
    config: { ...emptyConfig, modules: { study: { plansDir: dir, materialDirs: [] } } },
  });
  // Server first, then the folder: hooks run in registration order, and removing the folder while the state
  // writer still wrote to it failed with ENOTEMPTY under load.
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const start = performance.now();
  const response = await app.inject({ method: 'POST', url: '/trpc/study.activate', payload: { name: 'large.json' } });
  assert.equal(response.statusCode, 200);
  assert.ok(performance.now() - start < 2000);
  assert.equal((await app.inject('/trpc/study.index')).json().result.data.days.length, 500);
});

/** A one-subject plan of `count` equal days, the usual "one plan per course" case of decision 15. */
function course(id: string, count: number) {
  return planSchema.parse({
    schema: 'hub.study-plan/1',
    id,
    title: `Corso ${id}`,
    version: 1,
    subjects: [{ id: 'a', name: `Materia ${id}` }],
    threads: [],
    phases: [],
    method: [],
    days: Array.from({ length: count }, (_, i) => ({
      id: `D${i + 1}`,
      subject: 'a',
      title: `${id} ${i + 1}`,
      threads: [],
      recall: [],
      kind: 'study',
      blocks: [],
      check: '',
    })),
  });
}

void test('several active plans interleave by the global mix, and a paused plan leaves the sequence', async (t) => {
  const { readDaysById, readIndex } = await import('./read.ts');
  const db = openDatabase(':memory:', fileURLToPath(new URL('./drizzle', import.meta.url)));
  t.after(() => db.$client.close());
  // Same day ids in both plans: days are told apart by plan.
  savePlan(db, course('p', 10));
  savePlan(db, course('q', 10));
  const order = () => readIndex(db)?.days.map((day) => day.planId) ?? [];
  // Activating a second plan keeps the first; with no mix they share equally.
  assert.deepEqual(order().slice(0, 4), ['p', 'q', 'p', 'q']);
  assert.equal(readIndex(db)?.mixSet, false);
  db.$client
    .prepare('INSERT INTO preferences (plan_id, weekly_hours, mix) VALUES (?, ?, ?)')
    .run('*', 600, JSON.stringify({ 'p:a': 75, 'q:a': 25 }));
  const mixed = order().slice(0, 8);
  assert.equal(mixed.filter((plan) => plan === 'p').length, 6);
  assert.deepEqual(
    readIndex(db)
      ?.days.slice(0, 2)
      .map((day) => day.key),
    ['p/D1', 'q/D1'],
  );
  assert.deepEqual(
    readDaysById(db, ['q/D1']).map((day) => [day.planId, day.title]),
    [['q', 'q 1']],
  );
  // A third plan the mix does not name: the stored mix is set aside and the three share equally.
  savePlan(db, course('r', 3));
  assert.equal(readIndex(db)?.mixSet, false);
  assert.deepEqual(order().slice(0, 3).toSorted(), ['p', 'q', 'r']);
  // Pausing a plan takes its days out; resuming brings them back with the same mix.
  db.$client.prepare('UPDATE plans SET active = 0 WHERE id = ?').run('r');
  assert.equal(readIndex(db)?.mixSet, true);
  assert.ok(!order().includes('r'));
  assert.equal(readIndex(db)?.days.length, 20);
});

void test('progress and subject state survive reload and export valid state after rapid changes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'study-test-'));
  await mkdir(join(dir, 'in-arrivo'));
  await writeFile(
    join(dir, 'in-arrivo', 'example.json'),
    await readFile(new URL('./fixtures/example.json', import.meta.url)),
  );
  const config = { ...emptyConfig, modules: { study: { plansDir: dir, materialDirs: [] } } };
  const make = () => buildServer({ dbPath: join(dir, 'hub.db'), deps: { run: createFakeDesktop() }, config });
  let app = make();
  const post = (name: string, payload: object) => app.inject({ method: 'POST', url: `/trpc/study.${name}`, payload });
  assert.equal((await post('activate', { name: 'example.json' })).statusCode, 200);
  assert.equal((await post('setCurrent', { key: 'example/A02' })).statusCode, 200);
  assert.equal((await post('setAutonomy', { plan: 'example', id: 'plants', value: 'green' })).statusCode, 200);
  for (let n = 0; n < 10; n++)
    assert.equal((await post('setStep', { key: 'example/A02', id: 'A02.m.1', done: n % 2 === 1 })).statusCode, 200);
  assert.equal((await post('setNote', { key: 'example/A02', text: 'Nota' })).statusCode, 200);
  let index = (await app.inject('/trpc/study.index')).json().result.data;
  assert.equal(index.current, 'example/A02');
  assert.equal(index.days.find((day: { id: string }) => day.id === 'A02').done, true);
  assert.equal(index.days.find((day: { id: string }) => day.id === 'A01').done, false);
  await app.close();
  const exported = JSON.parse(await readFile(join(dir, 'stato', 'example.json'), 'utf8'));
  assert.equal(exported.currentDay, 'A02');
  assert.equal(exported.autonomy.plants, 'green');
  assert.equal(exported.days.find((day: { id: string }) => day.id === 'A02').note, 'Nota');
  assert.ok(Number.isFinite(Date.parse(exported.days.find((day: { id: string }) => day.id === 'A02').doneAt)));
  assert.deepEqual(exported.days.find((day: { id: string }) => day.id === 'A02').openSteps, []);
  app = make();
  // Server first, then the folder: hooks run in registration order, and removing the folder while the state
  // writer still wrote to it failed with ENOTEMPTY under load.
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  index = (await app.inject('/trpc/study.index')).json().result.data;
  assert.equal(index.current, 'example/A02');
  assert.equal((await post('setSubject', { plan: 'example', id: 'a', state: 'passed' })).statusCode, 200);
  index = (await app.inject('/trpc/study.index')).json().result.data;
  assert.equal(index.current, 'example/B01');
  assert.ok(index.hiddenDays.some((day: { id: string }) => day.id === 'A01'));
  assert.equal((await post('setSubject', { plan: 'example', id: 'a', state: 'active' })).statusCode, 200);
  index = (await app.inject('/trpc/study.index')).json().result.data;
  assert.equal(index.current, 'example/B01');
  assert.ok(index.days.some((day: { id: string }) => day.id === 'A01'));
});

void test('library confines PDF reads to configured material folders', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'study-library-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const materials = join(root, 'materials');
  await mkdir(join(materials, 'nested'), { recursive: true });
  await writeFile(join(materials, 'nested', 'lesson.pdf'), 'PDF');
  await writeFile(join(materials, 'notes.txt'), 'text');
  await writeFile(join(root, 'outside.pdf'), 'private');
  await symlink(join(root, 'outside.pdf'), join(materials, 'escape.pdf'));
  const app = buildServer({
    dbPath: ':memory:',
    deps: { run: createFakeDesktop() },
    config: { ...emptyConfig, modules: { study: { plansDir: '', materialDirs: [materials] } } },
  });
  t.after(() => app.close());
  const list = (await app.inject('/trpc/study.library')).json().result.data;
  assert.deepEqual(
    list.map((item: { path: string }) => item.path),
    ['nested/lesson.pdf'],
  );
  for (const path of ['../outside.pdf', join(root, 'outside.pdf'), 'escape.pdf', 'notes.txt']) {
    const response = await app.inject({ method: 'POST', url: '/trpc/study.openMaterial', payload: { path } });
    assert.notEqual(response.statusCode, 200, path);
  }
  const opened = await app.inject({
    method: 'POST',
    url: '/trpc/study.openMaterial',
    payload: { path: 'nested/lesson.pdf' },
  });
  assert.equal(opened.statusCode, 200);
  const fileId = opened.json().result.data.fileId;
  assert.equal((await app.inject(`/files/${fileId}?inline=1`)).body, 'PDF');
  const repeated = await Promise.all(
    Array.from({ length: 3 }, () =>
      app.inject({
        method: 'POST',
        url: '/trpc/study.openMaterial',
        payload: { path: 'nested/lesson.pdf' },
      }),
    ),
  );
  assert.deepEqual(
    repeated.map((response) => response.json().result.data.fileId),
    [fileId, fileId, fileId],
  );
  await writeFile(join(materials, 'nested', 'lesson.pdf'), 'UPDATED PDF');
  const changed = await app.inject({
    method: 'POST',
    url: '/trpc/study.openMaterial',
    payload: { path: 'nested/lesson.pdf' },
  });
  assert.notEqual(changed.json().result.data.fileId, fileId);
});

void test('tagged focus minutes reach Study and survive restart in the state file', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'study-focus-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'in-arrivo'));
  await writeFile(
    join(root, 'in-arrivo', 'example.json'),
    await readFile(new URL('./fixtures/example.json', import.meta.url)),
  );
  const options = {
    dbPath: join(root, 'core.db'),
    deps: { run: createFakeDesktop() },
    config: {
      ...emptyConfig,
      modules: { study: { plansDir: root, materialDirs: [] } },
      pomodoro: { ...emptyConfig.pomodoro, focusMinutes: 0.001 },
    },
  };
  const app = buildServer(options);
  assert.equal(
    (await app.inject({ method: 'POST', url: '/trpc/study.activate', payload: { name: 'example.json' } })).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ method: 'POST', url: '/trpc/pomodoro.startTagged', payload: { tag: 'study/example/A01' } }))
      .statusCode,
    200,
  );
  await new Promise((resolve) => setTimeout(resolve, 100));
  await app.inject('/trpc/pomodoro.state');
  await app.inject({ method: 'POST', url: '/trpc/pomodoro.stop', payload: {} });
  assert.equal((await app.inject({ method: 'POST', url: '/trpc/pomodoro.start', payload: {} })).statusCode, 200);
  await new Promise((resolve) => setTimeout(resolve, 100));
  await app.inject('/trpc/pomodoro.state');
  const minutes = (await app.inject('/trpc/study.focusMinutes')).json().result.data;
  assert.equal(minutes['study/example/A01'], 0.001);
  assert.equal(Object.keys(minutes).length, 1);
  await app.close();
  const state = JSON.parse(await readFile(join(root, 'stato', 'example.json'), 'utf8'));
  assert.equal(state.days.find((day: { id: string }) => day.id === 'A01').minutes, 0.001);
  const restarted = buildServer(options);
  t.after(() => restarted.close());
  assert.equal((await restarted.inject('/trpc/study.focusMinutes')).json().result.data['study/example/A01'], 0.001);
});

void test('error entries save with reference and cause, edit in place and reach the state file', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'study-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'in-arrivo'));
  await writeFile(
    join(dir, 'in-arrivo', 'example.json'),
    await readFile(new URL('./fixtures/example.json', import.meta.url)),
  );
  const app = buildServer({
    dbPath: ':memory:',
    deps: { run: createFakeDesktop() },
    config: { ...emptyConfig, modules: { study: { plansDir: dir, materialDirs: [] } } },
  });
  const post = (name: string, payload: object) => app.inject({ method: 'POST', url: `/trpc/study.${name}`, payload });
  const read = async (name: string) => (await app.inject(`/trpc/study.${name}`)).json().result.data;
  assert.equal((await post('activate', { name: 'example.json' })).statusCode, 200);
  // Only reference and cause.
  const saved = await post('setError', { key: 'example/A01', reference: 'Foglio 1, es. 3', cause: 'unit' });
  assert.equal(saved.statusCode, 200);
  const id = saved.json().result.data.id;
  assert.deepEqual(
    (await read('errors')).map(({ id: _id, ...rest }: Record<string, unknown>) => rest),
    [
      {
        planId: 'example',
        key: 'example/A01',
        reference: 'Foglio 1, es. 3',
        tried: '',
        cause: 'unit',
        method: '',
        retry: null,
        result: null,
      },
    ],
  );
  // Refused: no reference, an unknown cause, an unknown day, an unknown retry day, an entry that is not there.
  for (const bad of [
    { key: 'example/A01', reference: ' ', cause: 'unit' },
    { key: 'example/A01', reference: 'x', cause: 'luck' },
    { key: 'example/NOPE', reference: 'x', cause: 'unit' },
    { key: 'example/A01', reference: 'x', cause: 'unit', retry: 'example/NOPE' },
    { key: 'example/A01', reference: 'x', cause: 'unit', id: 'missing' },
  ])
    assert.notEqual((await post('setError', bad)).statusCode, 200, JSON.stringify(bad));
  const edited = await post('setError', {
    id,
    key: 'example/A01',
    reference: 'Foglio 1, es. 3',
    tried: 'Ho diviso per due',
    cause: 'calculation',
    method: 'Converti prima le unita',
    retry: 'example/B01',
    result: 'again',
  });
  assert.equal(edited.statusCode, 200);
  const errors = await read('errors');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].id, id);
  assert.equal(errors[0].cause, 'calculation');
  assert.equal(errors[0].retry, 'example/B01');
  await post('setAutonomy', { plan: 'example', id: 'plants', value: 'red' });
  await post('setAutonomy', { plan: 'example', id: 'stars', value: 'yellow' });
  const review = await read('review');
  assert.deepEqual(
    review.threads.map((thread: { id: string; value: string }) => [thread.id, thread.value]),
    [
      ['plants', 'red'],
      ['stars', 'yellow'],
    ],
  );
  assert.deepEqual(
    review.threads[0].days.map((day: { key: string }) => day.key),
    ['example/A01', 'example/A02'],
  );
  assert.deepEqual(review.half, []);
  await app.close();
  const exported = JSON.parse(await readFile(join(dir, 'stato', 'example.json'), 'utf8'));
  assert.equal(exported.errors.length, 1);
  assert.equal(exported.errors[0].cause, 'calculation');
  assert.equal(exported.errors[0].day, 'A01');
  assert.equal(exported.errors[0].retry, 'example/B01');
  assert.deepEqual(exported.removed, []);
});

void test('review lists a day with some steps ticked and its open steps', async (t) => {
  const source = JSON.parse(await readFile(new URL('./fixtures/example.json', import.meta.url), 'utf8'));
  source.days[0].blocks[0].steps.push({ id: 'A01.m.2', text: 'Disegna una foglia.' });
  const dir = await mkdtemp(join(tmpdir(), 'study-test-'));
  await mkdir(join(dir, 'in-arrivo'));
  await writeFile(join(dir, 'in-arrivo', 'example.json'), JSON.stringify(source));
  const app = buildServer({
    dbPath: ':memory:',
    deps: { run: createFakeDesktop() },
    config: { ...emptyConfig, modules: { study: { plansDir: dir, materialDirs: [] } } },
  });
  // Server first, then the folder: hooks run in registration order, and removing the folder while the state
  // writer still wrote to it failed with ENOTEMPTY under load.
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  const post = (name: string, payload: object) => app.inject({ method: 'POST', url: `/trpc/study.${name}`, payload });
  assert.equal((await post('activate', { name: 'example.json' })).statusCode, 200);
  assert.deepEqual((await app.inject('/trpc/study.review')).json().result.data.half, []);
  await post('setStep', { key: 'example/A01', id: 'A01.m.1', done: true });
  const [half] = (await app.inject('/trpc/study.review')).json().result.data.half;
  assert.equal(half.key, 'example/A01');
  assert.equal(half.total, 2);
  assert.deepEqual(half.open, [{ id: 'A01.m.2', text: 'Disegna una foglia.' }]);
  await post('setStep', { key: 'example/A01', id: 'A01.m.2', done: true });
  assert.deepEqual((await app.inject('/trpc/study.review')).json().result.data.half, []);
});

void test('day materials reach daysById unchanged and do not break the state file', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'study-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'in-arrivo'));
  const source = JSON.parse(await readFile(new URL('./fixtures/example.json', import.meta.url), 'utf8'));
  const materials = [{ path: 'Folder/Sheet 1.pdf', page: 3, label: 'Sheet' }, { path: 'Book/Chapter.pdf' }];
  source.days[0].materials = materials;
  await writeFile(join(dir, 'in-arrivo', 'example.json'), JSON.stringify(source));
  const config = { ...emptyConfig, modules: { study: { plansDir: dir, materialDirs: [] } } };
  const app = buildServer({ dbPath: join(dir, 'hub.db'), deps: { run: createFakeDesktop() }, config });
  const post = (name: string, payload: object) => app.inject({ method: 'POST', url: `/trpc/study.${name}`, payload });
  assert.equal((await post('activate', { name: 'example.json' })).statusCode, 200);
  const keys = encodeURIComponent(JSON.stringify({ keys: ['example/A01', 'example/A02'] }));
  const bodies = (await app.inject(`/trpc/study.daysById?input=${keys}`)).json().result.data;
  assert.deepEqual(bodies.find((day: { id: string }) => day.id === 'A01').materials, materials);
  assert.equal(bodies.find((day: { id: string }) => day.id === 'A02').materials, undefined);
  assert.equal((await post('setStep', { key: 'example/A01', id: 'A01.m.1', done: true })).statusCode, 200);
  await app.close();
  const exported = JSON.parse(await readFile(join(dir, 'stato', 'example.json'), 'utf8'));
  assert.deepEqual(exported.days.find((day: { id: string }) => day.id === 'A01').openSteps, []);
});

void test('searchRecords matches titles without case or accents, cuts at 3 and counts every match', async (t) => {
  const { searchDays } = await import('./read.ts');
  const db = openDatabase(':memory:', fileURLToPath(new URL('./drizzle', import.meta.url)));
  t.after(() => db.$client.close());
  const plan = course('p', 5);
  savePlan(db, {
    ...plan,
    days: plan.days.map((day, i) => ({ ...day, title: i === 4 ? 'Reazióni e redox' : `Reazioni ${i}` })),
  });
  const found = searchDays(db, 'REAZIONI');
  assert.equal(found.total, 5);
  assert.deepEqual(
    found.rows.map((row) => [row.key, row.g, row.done]),
    [
      ['p/D1', 1, false],
      ['p/D2', 2, false],
      ['p/D3', 3, false],
    ],
  );
  assert.deepEqual(
    searchDays(db, 'redox').rows.map((row) => row.key),
    ['p/D5'],
  );
  assert.deepEqual(searchDays(db, 'nessuno'), { total: 0, rows: [] });
});

void test('searchRecords is for the PC only: a paired phone is refused', async (t) => {
  const app = buildServer({ dbPath: ':memory:', deps: { run: createFakeDesktop() }, config: { ...emptyConfig } });
  t.after(() => app.close());
  const LAN = '192.0.2.30';
  const input = encodeURIComponent(JSON.stringify({ query: 'x' }));
  assert.equal((await app.inject(`/trpc/study.searchRecords?input=${input}`)).statusCode, 200);
  const code = (await app.inject({ method: 'POST', url: '/trpc/pairing.createCode', payload: {} })).json().result.data
    .code;
  const redeemed = await app.inject({
    method: 'POST',
    url: '/trpc/pairing.redeem',
    remoteAddress: LAN,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ code, deviceName: 'Phone' }),
  });
  const token: string = redeemed.json().result.data.token;
  const phone = await app.inject({
    url: `/trpc/study.searchRecords?input=${input}`,
    remoteAddress: LAN,
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(phone.statusCode, 403);
});

void test('paired device still reads study and calendar endpoints per Step 45', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'hub-study-device-'));
  await mkdir(join(dir, 'in-arrivo'));
  await writeFile(
    join(dir, 'in-arrivo', 'example.json'),
    await readFile(new URL('./fixtures/example.json', import.meta.url)),
  );
  const app = buildServer({
    dbPath: ':memory:',
    deps: { run: createFakeDesktop() },
    config: { ...emptyConfig, modules: { study: { plansDir: dir, materialDirs: [] } } },
  });
  t.after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });
  assert.equal(
    (await app.inject({ method: 'POST', url: '/trpc/study.activate', payload: { name: 'example.json' } })).statusCode,
    200,
  );

  const LAN = '192.0.2.31';
  const code = (await app.inject({ method: 'POST', url: '/trpc/pairing.createCode', payload: {} })).json().result.data
    .code;
  const redeemed = await app.inject({
    method: 'POST',
    url: '/trpc/pairing.redeem',
    remoteAddress: LAN,
    headers: { 'content-type': 'application/json' },
    payload: JSON.stringify({ code, deviceName: 'Tablet' }),
  });
  const token: string = redeemed.json().result.data.token;

  for (const url of [
    '/trpc/study.active',
    '/trpc/study.index',
    `/trpc/calendar.range?input=${encodeURIComponent(JSON.stringify({ from: '2026-11-01', to: '2026-11-30' }))}`,
  ]) {
    const res = await app.inject({
      url,
      remoteAddress: LAN,
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(res.statusCode, 200, url);
  }
});

void test('catalog actions retain their registry metadata and input schemas', async (t) => {
  const app = buildServer({ dbPath: ':memory:', deps: { run: createFakeDesktop() } });
  t.after(() => app.close());
  const response = await app.inject('/trpc/registry.list');
  assert.equal(response.statusCode, 200);
  const actions: {
    path: string;
    kind: string;
    label: string;
    description: string;
    danger: boolean;
    schema: unknown;
  }[] = response.json().result.data;
  const own = actions.filter((action) => action.path.startsWith('study.'));
  assert.deepEqual(own.map((action) => action.path).toSorted(), [
    'study.activate',
    'study.deleteBacklog',
    'study.deleteResource',
    'study.openMaterial',
    'study.openToday',
    'study.saveBacklog',
    'study.saveResource',
    'study.setAutonomy',
    'study.setBacklogStatus',
    'study.setCurrent',
    'study.setError',
    'study.setMix',
    'study.setNote',
    'study.setPlan',
    'study.setResourcePinned',
    'study.setStep',
    'study.setSubject',
  ]);
  for (const action of own) {
    assert.equal(action.kind, 'mutation');
    assert.ok(action.label.trim(), action.path);
    assert.ok(action.description.trim(), action.path);
    assert.equal(typeof action.danger, 'boolean', action.path);
    assert.ok('schema' in action, action.path);
  }
});
