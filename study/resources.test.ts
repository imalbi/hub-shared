import { strict as assert } from 'node:assert';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { emptyConfig } from '../../apps/server/src/core/config.ts';
import { createFakeDesktop } from '../../apps/server/src/testing/fake-desktop.ts';
import { buildServer as buildHubServer } from '../../apps/server/src/server.ts';
import study from './server.ts';
import { buildServer } from './test-server.ts';

process.env.NODE_ENV = 'test';

void test('resources validate targets, isolate subjects and plans, reject stale writes and survive catalog replacement', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'study-resources-'));
  const roots = [join(dir, 'one'), join(dir, 'two')];
  const config = { ...emptyConfig, modules: { study: { plansDir: join(dir, 'plans'), materialDirs: roots } } };
  const dbPath = join(dir, 'hub.db');
  let app = buildServer({ dbPath, config, deps: { run: createFakeDesktop() } });
  const post = (method: string, payload: object) =>
    app.inject({ method: 'POST', url: `/trpc/study.${method}`, payload });
  const scope = { planId: 'example', subjectId: 'a' };
  const list = async (input = scope) =>
    (await app.inject(`/trpc/study.resources?input=${encodeURIComponent(JSON.stringify(input))}`)).json().result.data;
  const base = { ...scope, title: 'Capitolo', kind: 'note', body: '# Testo' };
  try {
    await mkdir(join(dir, 'plans', 'in-arrivo'), { recursive: true });
    for (const root of roots) {
      await mkdir(root);
      await writeFile(join(root, 'dispensa.pdf'), '%PDF-example');
    }
    await cp(new URL('./fixtures/example.json', import.meta.url), join(dir, 'plans', 'in-arrivo', 'example.json'));
    assert.equal((await post('activate', { name: 'example.json' })).statusCode, 200);
    for (const invalid of [
      { title: '' },
      { title: ' ' },
      { title: 'x'.repeat(201) },
      { body: 'x'.repeat(100001) },
      { subjectId: 'missing' },
      { planId: 'missing' },
      { kind: 'link', url: 'javascript:alert(1)' },
      { kind: 'link', url: 'file:///tmp/example.pdf' },
      { kind: 'link', url: 'https://example.com/' + 'x'.repeat(2048) },
      { kind: 'pdf', path: '../dispensa.pdf', folder: 0 },
      { kind: 'pdf', path: 'dispensa.pdf', folder: 0, page: 0 },
      { kind: 'pdf', path: 'dispensa.pdf', folder: -1 },
    ])
      assert.equal((await post('saveResource', { ...base, ...invalid })).statusCode, 400);
    assert.equal(
      (await post('saveResource', { ...base, kind: 'pdf', path: 'missing.pdf', folder: 0 })).statusCode,
      404,
    );
    const created = await post('saveResource', { ...base, title: ' Capitolo ' });
    assert.equal(created.statusCode, 200);
    const resource: { id: string; revision: number } = created.json().result.data;
    assert.equal(resource.revision, 1);
    assert.equal((await list())[0].title, 'Capitolo');
    assert.equal((await list())[0].pinned, false);
    assert.equal((await post('saveResource', { ...base, ...resource, body: 'Nuovo testo' })).statusCode, 200);
    assert.equal((await post('saveResource', { ...base, ...resource, body: 'Stale' })).statusCode, 409);
    assert.equal((await post('setResourcePinned', { ...resource, pinned: true })).statusCode, 409);
    assert.equal((await post('deleteResource', { ...resource, confirmed: true })).statusCode, 409);
    assert.equal((await post('saveResource', { ...base, id: resource.id })).statusCode, 400);
    assert.equal((await post('setResourcePinned', { id: resource.id, revision: 2, pinned: true })).statusCode, 200);
    assert.equal((await list())[0].body, 'Nuovo testo');
    assert.equal((await list())[0].pinned, true);
    assert.deepEqual(await list({ ...scope, subjectId: 'b' }), []);
    const plan = JSON.parse(await readFile(new URL('./fixtures/example.json', import.meta.url), 'utf8'));
    plan.id = 'other';
    await writeFile(join(dir, 'plans', 'in-arrivo', 'other.json'), JSON.stringify(plan));
    assert.equal((await post('activate', { name: 'other.json' })).statusCode, 200);
    assert.deepEqual(await list({ ...scope, planId: 'other' }), []);
    plan.id = 'example';
    plan.version = 2;
    await writeFile(join(dir, 'plans', 'in-arrivo', 'revision.json'), JSON.stringify(plan));
    assert.equal((await post('activate', { name: 'revision.json' })).statusCode, 200);
    assert.equal((await list())[0].body, 'Nuovo testo');
    for (const folder of [0, 1])
      assert.equal(
        (await post('saveResource', { ...base, kind: 'pdf', path: 'dispensa.pdf', folder, page: 2, pinned: true }))
          .statusCode,
        200,
      );
    assert.deepEqual(
      (await list()).filter((row: { kind: string }) => row.kind === 'pdf').map((row: { folder: number }) => row.folder),
      [0, 1],
    );
    assert.equal((await post('saveResource', { ...base, kind: 'link', url: 'https://example.com' })).statusCode, 200);
    await post('setPlan', { id: 'example', active: false });
    assert.equal((await list()).length, 4);
    const subjects = (await app.inject('/trpc/study.resourceSubjects')).json().result.data;
    assert.ok(subjects.some((item: { planId: string; id: string }) => item.planId === 'example' && item.id === 'a'));
    await app.close();
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
    assert.equal((await list()).length, 4);
    assert.equal((await list())[0].revision, 3);
    assert.equal((await post('deleteResource', { id: resource.id, revision: 3 })).statusCode, 412);
    assert.equal((await post('setResourcePinned', { id: resource.id, revision: 3, pinned: false })).statusCode, 200);
    assert.equal((await list())[0].pinned, false);
    assert.equal((await list())[0].body, 'Nuovo testo');
    assert.equal((await post('setResourcePinned', { id: resource.id, revision: 3, pinned: true })).statusCode, 409);

    for (const row of await list())
      assert.equal(
        (await post('deleteResource', { id: row.id, revision: row.revision, confirmed: true })).statusCode,
        200,
      );
    assert.deepEqual(await list(), []);
    assert.equal(await readFile(join(roots[0] ?? '', 'dispensa.pdf'), 'utf8'), '%PDF-example');
    assert.equal((await post('deleteResource', { id: resource.id, revision: 3, confirmed: true })).statusCode, 404);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});
