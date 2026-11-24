import { DatabaseSync } from 'node:sqlite';
import { comparisonKey } from './key.ts';

// Backfill after any `comparisonKey` change (agencies, group tails, word order; 2026-11-11 the place bracket): rows saved under the old
// key are regrouped, one is kept and the others get a blacklist rule on their key with a note saying which.
// Dry run unless `--apply`: `node modules.local/lavoro/dedupe.ts <lavoro.db> [--apply]`. // guard-private: allow Repository-local module path

export type DedupeRow = {
  key: string;
  company: string;
  title: string;
  location: string;
  score: number;
  hasDescription: boolean;
  applied: boolean;
  firstSeen: number;
  blacklisted: boolean;
};

/** Applied first, then a saved description, then the higher score, then the older row. */
const better = (a: DedupeRow, b: DedupeRow) =>
  Number(b.applied) - Number(a.applied) ||
  Number(b.hasDescription) - Number(a.hasDescription) ||
  b.score - a.score ||
  a.firstSeen - b.firstSeen;

/** Two applied rows are two applications, never one duplicate of the other: both are kept. */
export function planDuplicates(rows: readonly DedupeRow[]) {
  const groups = new Map<string, DedupeRow[]>();
  for (const row of rows) {
    if (row.blacklisted) continue;
    const key = comparisonKey(row.company, row.title, row.location);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const hide: Array<{ key: string; keptKey: string; note: string }> = [];
  for (const group of groups.values()) {
    const [kept, ...rest] = group.toSorted(better);
    if (!kept) continue;
    for (const row of rest) {
      if (row.applied) continue;
      hide.push({ key: row.key, keptKey: kept.key, note: `Duplicato di ${kept.company} / ${kept.title}` });
    }
  }
  return {
    comparisonKeys: new Map(rows.map((row) => [row.key, comparisonKey(row.company, row.title, row.location)])),
    hide,
  };
}

function run(path: string, apply: boolean) {
  const db = new DatabaseSync(path);
  const rows = db
    .prepare(
      `select j.key, j.company, j.title, j.location, j.score, j.description is not null as d, j.first_seen as f,
        j.blacklist_rule is not null as b, exists(select 1 from job_applied a where a.key = j.key) as a from jobs j`,
    )
    .all()
    .map((r) => ({
      key: String(r.key),
      company: String(r.company),
      title: String(r.title),
      location: String(r.location),
      score: Number(r.score),
      hasDescription: Boolean(r.d),
      applied: Boolean(r.a),
      firstSeen: Number(r.f),
      blacklisted: Boolean(r.b),
    }));
  const plan = planDuplicates(rows);
  for (const h of plan.hide) process.stdout.write(`${h.key}  ->  ${h.note}\n`);
  process.stdout.write(`${plan.hide.length} duplicates to blacklist${apply ? '' : ' (dry run, pass --apply)'}\n`);
  if (!apply) return;
  db.exec('begin');
  const setCmp = db.prepare('update jobs set comparison_key = ? where key = ?');
  for (const [key, cmp] of plan.comparisonKeys) setCmp.run(cmp, key);
  const addRule = db.prepare(
    "insert into blacklist_rules (enabled, field, match_type, value, note, created_at) values (1, 'key', 'equals', ?, ?, ?) returning id",
  );
  const link = db.prepare('update jobs set blacklist_rule = ? where key = ?');
  for (const h of plan.hide) link.run(Number(addRule.get(h.key, h.note, Date.now())?.id), h.key);
  db.exec('commit');
}

if (process.argv[1]?.endsWith('dedupe.ts') && process.argv[2]) run(process.argv[2], process.argv.includes('--apply'));
