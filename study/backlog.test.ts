import { strict as assert } from 'node:assert';
import { cp, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { emptyConfig } from '../../apps/server/src/core/config.ts';
import { buildServer as buildHubServer } from '../../apps/server/src/server.ts';
import { createFakeDesktop } from '../../apps/server/src/testing/fake-desktop.ts';
import study from './server.ts';
import { buildServer } from './test-server.ts';

process.env.NODE_ENV = 'test';

void test('backlog survives edits, completion, reopening and a replaced catalog installation without scheduling', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-backlog-'));
  const config = { ...emptyConfig, modules: { study: { plansDir: join(dir, 'plans'), materialDirs: [] } } };
  const dbPath = join(dir, 'hub.db');
  let app = buildServer({ dbPath, config, deps: { run: createFakeDesktop() } });
  const post = (method: string, payload: object) =>
    app.inject({ method: 'POST', url: `/trpc/study.${method}`, payload });
  const list = async () => (await app.inject('/trpc/study.backlog')).json().result.data;
  try {
    assert.deepEqual(await list(), []);
    assert.equal((await app.inject('/trpc/study.index')).json().result.data, null);
    const created = await post('saveBacklog', {
      title: '  Corso esempio  ',
      note: '  Prima le basi  ',
      url: ' https://example.com/course ',
    });
    assert.equal(created.statusCode, 200);
    const id: string = created.json().result.data.id;
    assert.ok(id);
    await post('saveBacklog', { title: 'Secondo corso' });
    assert.deepEqual(
      (await list()).map((item: { title: string }) => item.title),
      ['Corso esempio', 'Secondo corso'],
    );
    assert.equal((await list())[0].note, 'Prima le basi');
    assert.equal((await list())[0].url, 'https://example.com/course');
    assert.equal(
      (await post('saveBacklog', { id, title: 'Corso rivisto', note: 'Nuova nota', status: 'completed' })).statusCode,
      200,
    );
    for (const status of ['todo', 'active', 'completed']) {
      assert.equal((await post('setBacklogStatus', { id, status })).statusCode, 200);
      assert.equal((await list())[0].status, status);
    }
    assert.equal((await list())[0].id, id);
    assert.equal((await list())[0].note, 'Nuova nota');
    assert.equal((await post('deleteBacklog', { id })).statusCode, 412);
    assert.equal((await post('deleteBacklog', { id, confirmed: false })).statusCode, 412);
    assert.equal((await list()).length, 2);
    await mkdir(join(dir, 'plans', 'in-arrivo'), { recursive: true });
    await cp(new URL('./fixtures/example.json', import.meta.url), join(dir, 'plans', 'in-arrivo', 'example.json'));
    assert.equal((await post('activate', { name: 'example.json' })).statusCode, 200);
    const snapshot = async () =>
      Promise.all(
        ['index', 'progress', 'active', 'days?input=%7B%22offset%22%3A0%2C%22limit%22%3A10%7D'].map(
          async (method) => (await app.inject(`/trpc/study.${method}`)).json().result.data,
        ),
      );
    const before = await snapshot();
    assert.equal((await post('setBacklogStatus', { id, status: 'todo' })).statusCode, 200);
    assert.equal(
      (await post('saveBacklog', { id, title: 'Corso rivisto', note: 'Nuova nota', status: 'active' })).statusCode,
      200,
    );
    assert.deepEqual(await snapshot(), before);
    await app.close();
    // Catalog replacement changes code/migrations, while the module DB remains beside the core DB.
    const replacement = join(dir, 'catalog-v2', 'drizzle');
    await cp(new URL('./drizzle', import.meta.url), replacement, { recursive: true });
    app = buildHubServer({
      dbPath,
      config,
      deps: {
        run: createFakeDesktop(),
        testModules: [
          {
            ...study,
            migrations: replacement,
            create(deps) {
              return study.create({ ...deps, config: config.modules.study });
            },
          },
        ],
      },
    });
    assert.equal((await list())[0].title, 'Corso rivisto');
    assert.equal((await list())[0].note, 'Nuova nota');
    assert.equal((await list())[0].status, 'active');
    assert.equal((await list())[0].id, id);
    assert.equal((await post('deleteBacklog', { id, confirmed: true })).statusCode, 200);
    assert.equal((await list()).length, 1);
    for (const [method, payload] of [
      ['saveBacklog', { id, title: 'Cannot recreate' }],
      ['setBacklogStatus', { id, status: 'todo' }],
      ['deleteBacklog', { id, confirmed: true }],
    ] satisfies [string, object][])
      assert.equal((await post(method, payload)).statusCode, 404);
    assert.equal((await list()).length, 1);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

void test('backlog rejects invalid boundaries, unsafe links and states, and accepts exact limits', async (t) => {
  const app = buildServer({
    dbPath: ':memory:',
    config: { ...emptyConfig, modules: { study: { plansDir: '', materialDirs: [] } } },
    deps: { run: createFakeDesktop() },
  });
  t.after(() => app.close());
  const post = (payload: object) => app.inject({ method: 'POST', url: '/trpc/study.saveBacklog', payload });
  for (const invalid of [
    { title: '' },
    { title: '   ' },
    { title: 'x'.repeat(201) },
    { title: 'Course', note: 'x'.repeat(1001) },
    ...[
      'javascript:alert(1)',
      'file:///tmp/example.pdf',
      'data:text/plain,hello',
      'ftp://example.com',
      '/relative',
      'https://example.com/' + 'x'.repeat(2048),
    ].map((url) => ({ title: 'Course', url })),
    { title: 'Course', status: 'later' },
  ])
    assert.equal((await post(invalid)).statusCode, 400);
  assert.equal(
    (
      await post({
        title: 'x'.repeat(200),
        note: 'x'.repeat(1000),
        url: 'https://example.com/' + 'x'.repeat(2028),
        status: 'todo',
      })
    ).statusCode,
    200,
  );
  const response = await app.inject({
    method: 'POST',
    url: '/trpc/study.setBacklogStatus',
    payload: { id: 'missing', status: 'later' },
  });
  assert.equal(response.statusCode, 400);
  assert.equal((await app.inject('/trpc/study.backlog')).json().result.data.length, 1);
});
