import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { technicalDescription } from './dedupe-fixture.ts';
import { planDuplicates, type DedupeRow } from './dedupe.ts';

const row = (key: string, company: string, title: string, over: Partial<DedupeRow> = {}): DedupeRow => ({
  key,
  company,
  title,
  location: '',
  score: 10,
  hasDescription: false,
  applied: false,
  firstSeen: 1,
  blacklisted: false,
  ...over,
});

void test('one row is kept per posting: the applied one, then the one with a description', () => {
  const plan = planDuplicates([
    row('a', 'Iren', 'Addetto/a junior manutenzione'),
    row('b', 'Iren Spa', 'Addetto junior manutenzione', { hasDescription: true }),
    row('c', 'Iren tramite Synergie', 'Manutenzione junior addetto', { applied: true }),
  ]);
  assert.deepEqual(
    plan.hide.map((h) => [h.key, h.keptKey]).toSorted((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1])),
    [
      ['a', 'c'],
      ['b', 'c'],
    ],
  );
  assert.match(plan.hide[0]?.note ?? '', /^Duplicato di Iren tramite Synergie/);
});

void test('applied rows are never hidden and rows already blacklisted are ignored', () => {
  const plan = planDuplicates([
    row('a', 'Acme', 'Dev', { applied: true }),
    row('b', 'Acme srl', 'Dev', { applied: true }),
    row('c', 'Acme', 'dev', { blacklisted: true }),
  ]);
  assert.deepEqual(plan.hide, []);
});

void test('aliases group companies and direct source beats agency before score', () => {
  const plan = planDuplicates(
    [
      row('agency', 'Controllata', 'Frontend developer', { site: 'manpower', hasDescription: true, score: 99 }),
      row('direct', 'Acme', 'Frontend developer', { site: 'direct', hasDescription: true }),
    ],
    { companyAliases: { controllata: 'Acme' } },
  );
  assert.deepEqual(
    plan.hide.map((h) => [h.key, h.keptKey]),
    [['agency', 'direct']],
  );
});
void test('description groups cross-source titles while different direct employers stay distinct', () => {
  const plan = planDuplicates([
    row('agency', 'Alpha Agenzia', 'Frontend developer', {
      site: 'synergie',
      description: technicalDescription,
      hasDescription: true,
    }),
    row('direct', 'Acme', 'Frontend developer prodotto', {
      site: 'direct',
      description: technicalDescription,
      hasDescription: true,
    }),
    row('other', 'Beta', 'Frontend developer servizio', {
      site: 'direct',
      description: technicalDescription,
      hasDescription: true,
    }),
  ]);
  assert.deepEqual(
    plan.hide.map((h) => [h.key, h.keptKey]),
    [['agency', 'direct']],
  );
});

void test('CLI dry run writes nothing and apply protects applications with file or inline settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hub-dedupe-test-'));
  const path = join(dir, 'fixture.db');
  const config = JSON.stringify({ companyAliases: { Controllata: 'Acme' } });
  const configPath = join(dir, 'dedupe.json');
  writeFileSync(configPath, config);
  const db = new DatabaseSync(path);
  try {
    db.exec(`create table jobs (key text primary key, company text, title text, location text,
      site text, description text, details_missing integer, score integer, first_seen integer,
      blacklist_rule integer, comparison_key text);
      create table job_deleted (key text);
      create table job_applied (key text);
      create table blacklist_rules (id integer primary key, enabled integer, field text, match_type text,
        value text, note text, created_at integer);`);
    const insert = db.prepare("insert into jobs values (?, ?, 'Developer', '', ?, null, 0, 10, 1, null, 'old')");
    insert.run('agency', 'Controllata', 'manpower');
    insert.run('direct', 'Acme', 'direct');
    insert.run('applied1', 'Acme', 'direct');
    insert.run('applied2', 'Acme', 'direct');
    db.exec("insert into job_applied values ('applied1'), ('applied2')");
    const before = readFileSync(path);
    const cli = new URL('./dedupe.ts', import.meta.url).pathname;
    const dry = spawnSync(process.execPath, [cli, path, '--config', configPath], { encoding: 'utf8' });
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /2 duplicates.*dry run/);
    assert.deepEqual(readFileSync(path), before);
    const apply = spawnSync(process.execPath, [cli, path, '--config', config, '--apply'], { encoding: 'utf8' });
    assert.equal(apply.status, 0, apply.stderr);
    assert.equal(db.prepare('select count(*) as n from blacklist_rules').get()?.n, 2);
    assert.equal(db.prepare('select count(*) as n from jobs where blacklist_rule is null').get()?.n, 2);
    assert.equal(db.prepare("select count(*) as n from jobs where comparison_key = 'acme|developer'").get()?.n, 4);
    assert.equal(db.prepare('select count(*) as n from job_applied').get()?.n, 2);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
