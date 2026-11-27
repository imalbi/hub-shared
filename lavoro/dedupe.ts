import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { type Profile, dedupeSchema } from './config.ts';
import { canCompareDescriptions, descriptionSimilarity } from './similarity.ts';
import { agencySites, comparisonKey } from './key.ts';

// Backfill after any `comparisonKey` change (agencies, group tails, word order; 2026-11-11 the place bracket): rows saved under the old
// key are regrouped, one is kept and the others get a blacklist rule on their key with a note saying which.
// Dry run unless `--apply`: `node modules.local/lavoro/dedupe.ts <lavoro.db> [--config <dedupe JSON or path>] [--apply]`. // guard-private: allow Repository-local module path

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
  site?: string;
  description?: string | null;
  detailsMissing?: boolean;
  deleted?: boolean;
};

/** Applied first, then a saved description, then a direct source, then score and age. */
const better = (a: DedupeRow, b: DedupeRow) =>
  Number(b.applied) - Number(a.applied) ||
  Number(b.hasDescription) - Number(a.hasDescription) ||
  Number(agencySites.has(a.site ?? '')) - Number(agencySites.has(b.site ?? '')) ||
  b.score - a.score ||
  a.firstSeen - b.firstSeen;

/** Two applied rows are two applications, never one duplicate of the other: both are kept. */
export function planDuplicates(rows: readonly DedupeRow[], options: Partial<Profile['dedupe']> = {}) {
  const settings = dedupeSchema.parse(options);
  const groups: DedupeRow[][] = [];
  const cmp = (row: DedupeRow) => comparisonKey(row.company, row.title, row.location, settings.companyAliases);
  const employer = (row: DedupeRow) => ({ company: row.company, site: row.site ?? '' });
  for (const row of rows.toSorted(better)) {
    if (row.blacklisted || row.deleted) continue;
    const group = groups.find(
      (members) =>
        members.every((member) => canCompareDescriptions(employer(member), employer(row), settings.companyAliases)) &&
        members.some(
          (member) =>
            cmp(member) === cmp(row) ||
            (member.hasDescription &&
              row.hasDescription &&
              !member.detailsMissing &&
              !row.detailsMissing &&
              descriptionSimilarity(member.description ?? '', row.description ?? '', settings.minDescriptionChars) >=
                settings.descriptionSimilarity),
        ),
    );
    if (group) group.push(row);
    else groups.push([row]);
  }
  const hide: Array<{ key: string; keptKey: string; note: string }> = [];
  for (const group of groups) {
    const [kept, ...rest] = group.toSorted(better);
    if (!kept) continue;
    for (const row of rest) {
      if (row.applied) continue;
      hide.push({ key: row.key, keptKey: kept.key, note: `Duplicato di ${kept.company} / ${kept.title}` });
    }
  }
  return {
    comparisonKeys: new Map(rows.map((row) => [row.key, cmp(row)])),
    hide,
  };
}

export function runDedupe(path: string, apply: boolean, settings = dedupeSchema.parse({})) {
  const db = new DatabaseSync(path, { readOnly: !apply });
  try {
    const rows = db
      .prepare(
        `select j.key, j.company, j.title, j.location, j.site, j.description, j.details_missing, j.score, j.description is not null as d, j.first_seen as f,
        exists(select 1 from job_deleted d where d.key = j.key) as deleted,
        j.blacklist_rule is not null as b, exists(select 1 from job_applied a where a.key = j.key) as a from jobs j`,
      )
      .all()
      .map((r) => ({
        key: String(r.key),
        company: String(r.company),
        title: String(r.title),
        location: String(r.location),
        score: Number(r.score),
        site: String(r.site),
        description: typeof r.description === 'string' ? r.description : null,
        detailsMissing: Boolean(r.details_missing),
        deleted: Boolean(r.deleted),
        hasDescription: Boolean(r.d),
        applied: Boolean(r.a),
        firstSeen: Number(r.f),
        blacklisted: Boolean(r.b),
      }));
    const plan = planDuplicates(rows, settings);
    for (const h of plan.hide) process.stdout.write(`${h.key}  ->  ${h.note}\n`);
    process.stdout.write(`${plan.hide.length} duplicates to blacklist${apply ? '' : ' (dry run, pass --apply)'}\n`);
    if (!apply) return plan;
    db.exec('begin');
    const setCmp = db.prepare('update jobs set comparison_key = ? where key = ?');
    for (const [key, cmp] of plan.comparisonKeys) setCmp.run(cmp, key);
    const addRule = db.prepare(
      "insert into blacklist_rules (enabled, field, match_type, value, note, created_at) values (1, 'key', 'equals', ?, ?, ?) returning id",
    );
    const link = db.prepare('update jobs set blacklist_rule = ? where key = ?');
    for (const h of plan.hide) link.run(Number(addRule.get(h.key, h.note, Date.now())?.id), h.key);
    db.exec('commit');
    return plan;
  } finally {
    db.close();
  }
}

if (process.argv[1]?.endsWith('dedupe.ts') && process.argv[2]) {
  const configIndex = process.argv.indexOf('--config');
  const config = configIndex === -1 ? '{}' : process.argv[configIndex + 1];
  if (!config) throw new Error('--config requires a JSON object or file path');
  const settings = dedupeSchema.parse(
    JSON.parse(config.trimStart().startsWith('{') ? config : readFileSync(config, 'utf8')),
  );
  runDedupe(process.argv[2], process.argv.includes('--apply'), settings);
}
