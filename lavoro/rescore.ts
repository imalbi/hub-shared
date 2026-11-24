import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../apps/server/src/core/config.ts';
import { eq } from '../../apps/server/src/core/module-db.ts';
import { moduleDbPath, openDatabase, type Db } from '../../apps/server/src/db/index.ts';
import { profileSchema } from './config.ts';
import { jobs } from './schema.ts';
import { createScorer } from './score.ts';

export type RescoreResult = {
  total: number;
  updated: number;
  unchanged: number;
  passedMinScoreBefore: number;
  passedMinScoreAfter: number;
};

export function rescoreJobs(
  db: Db,
  scorer: ReturnType<typeof createScorer>,
  minScore: number,
  options: { dryRun?: boolean } = {},
): RescoreResult {
  const all = db.select().from(jobs).all();
  let updated = 0;
  let unchanged = 0;
  let passedMinScoreBefore = 0;
  let passedMinScoreAfter = 0;

  const updates: Array<{ key: string; patch: Partial<typeof jobs.$inferInsert> }> = [];

  for (const job of all) {
    if (job.score >= minScore) passedMinScoreBefore++;

    const result = scorer.score({
      title: job.title,
      company: job.company,
      location: job.location,
      site: job.site,
      description: job.description ?? undefined,
      declaredMode: job.workMode ?? undefined,
    });
    const categories = scorer.categories({
      title: job.title,
      company: job.company,
      site: job.site,
      description: job.description ?? undefined,
    });

    if (result.score >= minScore) passedMinScoreAfter++;

    const isRemote = result.workMode === 'remote';

    const scoreChanged = job.score !== result.score;
    const totalChanged = job.total !== result.total;
    const reasonsChanged = JSON.stringify(job.reasons) !== JSON.stringify(result.reasons);
    const categoriesChanged = JSON.stringify(job.categories) !== JSON.stringify(categories);
    const workModeChanged = job.workMode !== result.workMode;
    const remoteChanged = job.isRemote !== isRemote;

    if (scoreChanged || totalChanged || reasonsChanged || categoriesChanged || workModeChanged || remoteChanged) {
      updated++;
      updates.push({
        key: job.key,
        patch: {
          score: result.score,
          total: result.total,
          reasons: result.reasons,
          categories,
          workMode: result.workMode,
          isRemote,
        },
      });
    } else {
      unchanged++;
    }
  }

  if (!options.dryRun && updates.length > 0) {
    db.transaction((tx) => {
      for (const { key, patch } of updates) {
        tx.update(jobs).set(patch).where(eq(jobs.key, key)).run();
      }
    });
  }

  return { total: all.length, updated, unchanged, passedMinScoreBefore, passedMinScoreAfter };
}

if (import.meta.main) {
  const dryRun = process.argv.includes('--dry-run');
  const loaded = loadConfig();
  const rawProfile = (loaded as { modules?: Record<string, unknown> }).modules?.lavoro;
  if (!rawProfile) {
    process.stderr.write(
      'Nessuna configurazione trovata per il modulo lavoro in config.local.json (chiave modules.lavoro mancante).\n',
    );
    process.exit(1);
  }

  const profile = profileSchema.parse(rawProfile);
  const scorer = createScorer(profile);

  const dbPath = process.env.HUB_DB
    ? moduleDbPath(process.env.HUB_DB, 'lavoro')
    : join(homedir(), '.local/state/hub/modules/lavoro.db');

  if (!existsSync(dbPath)) {
    process.stderr.write(`Database del modulo lavoro non trovato in ${dbPath}\n`);
    process.exit(1);
  }

  const migrations = fileURLToPath(new URL('./drizzle', import.meta.url));
  const db = openDatabase(dbPath, migrations);

  try {
    const stats = rescoreJobs(db, scorer, profile.filter.minScore, { dryRun });
    if (dryRun) {
      process.stdout.write(
        `[DRY RUN] ${stats.total} offerte esaminate: ${stats.updated} verrebbero aggiornate, ${stats.unchanged} invariate.\n` +
          `Soglia minScore (${profile.filter.minScore}): ${stats.passedMinScoreBefore} passavano prima -> ${stats.passedMinScoreAfter} passerebbero ora.\n` +
          `Esegui senza --dry-run per applicare le modifiche.\n`,
      );
    } else {
      process.stdout.write(
        `Ricalcolo completato: ${stats.updated} offerte aggiornate su ${stats.total} (${stats.unchanged} invariate).\n` +
          `Soglia minScore (${profile.filter.minScore}): ${stats.passedMinScoreBefore} passavano prima -> ${stats.passedMinScoreAfter} passano ora.\n`,
      );
    }
  } finally {
    db.$client.close();
  }
}
