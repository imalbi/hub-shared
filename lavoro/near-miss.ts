import { desc, inArray, lt, sql } from '../../apps/server/src/core/module-db.ts';
import type { Db } from '../../apps/server/src/db/index.ts';
import type { Profile } from './config.ts';
import { nearMisses } from './schema.ts';
import { createScorer, type ScoreResult } from './score.ts';

const day = 86_400_000;
export const nearMissDays = 30;
export const nearMissLimit = 300;
export const nearMissTextLimit = 20_000;

type Margin = Pick<Profile['filter'], 'minScore' | 'minTitleScore' | 'nearMiss'>;

/**
 * Refused by the score gates alone, each gate that refused it by at most `nearMiss` points. Protected categories and
 * `escluso:` are other gates; the caller has already checked that the posting is not selected.
 */
export function isNearMiss(result: Pick<ScoreResult, 'score' | 'titleScore' | 'reasons'>, filter: Margin) {
  if (filter.nearMiss <= 0) return false;
  if (result.reasons.some((r) => r.startsWith('categorie protette:') || r.startsWith('escluso:'))) return false;
  const isStabile = result.reasons.some((r) => r === 'stabile:azienda' || r === 'stabile:fonte');
  if (isStabile && result.reasons.includes('stabile:sotto soglia')) {
    return filter.minScore - result.score <= filter.nearMiss;
  }
  return (
    filter.minScore - result.score <= filter.nearMiss && filter.minTitleScore - result.titleScore <= filter.nearMiss
  );
}

/** Points still needed when it was refused: the larger deficit of the two score gates, so a short title never reads 0. */
export function pointsMissing(
  row: Pick<typeof nearMisses.$inferSelect, 'score' | 'titleScore' | 'minScore' | 'minTitleScore'>,
) {
  return Math.max(0, row.minScore - row.score, row.minTitleScore - row.titleScore);
}

/** Rows older than 30 days (by last seen) and anything beyond the newest 300 go. Runs inside the save transaction. */
export function trimNearMisses(db: Pick<Db, 'select' | 'delete'>, nowMs: number) {
  db.delete(nearMisses)
    .where(lt(nearMisses.lastSeen, new Date(nowMs - nearMissDays * day)))
    .run();
  const stale = db
    .select({ key: nearMisses.key })
    .from(nearMisses)
    .orderBy(desc(nearMisses.lastSeen), desc(nearMisses.firstSeen), sql`${nearMisses.key} desc`)
    .all()
    .slice(nearMissLimit)
    .map((row) => row.key);
  if (stale.length) db.delete(nearMisses).where(inArray(nearMisses.key, stale)).run();
}

export type NearMissRow = Pick<typeof nearMisses.$inferSelect, 'title' | 'score' | 'titleScore' | 'reasons'> & {
  description: string | null;
  company: string;
  location: string;
  site: string;
};

export type WordSuggestion = { word: string; postings: number; entering: number };

// Function words of both languages: whole title words that say nothing about the role.
const stopWords = new Set(
  (
    'with from that this those these your their have will able into over under and the for are you our not but all ' +
    'una uno uni dei del della delle degli dello nel nella nelle negli per con tra fra che sia sono come anche più ' +
    'alla alle agli allo dal dalla dalle dagli sul sulla sulle presso area junior'
  ).split(' '),
);

const wordsOf = (title: string) => [...new Set(title.toLowerCase().match(/\p{L}{4,}/gu) ?? [])];

/**
 * Words of near-miss titles (at least 4 letters, not a stop word, not already weighted) found in at least two titles,
 * each with how many of those postings the gates would let in with +2 on the word. Entering is computed with the
 * module's own scorer and `isSelected`, never estimated. Top 10 by entering, then by postings.
 */
export function suggestWords(rows: readonly NearMissRow[], profile: Profile) {
  const count = new Map<string, number>();
  for (const row of rows) for (const word of wordsOf(row.title)) count.set(word, (count.get(word) ?? 0) + 1);
  const weighted = new Set(Object.keys(profile.weights.title).map((word) => word.toLowerCase()));
  const suggestions: WordSuggestion[] = [];
  for (const [word, postings] of count) {
    if (postings < 2 || stopWords.has(word) || weighted.has(word)) continue;
    const trial = createScorer({
      ...profile,
      weights: { ...profile.weights, title: { ...profile.weights.title, [word]: 2 } },
    });
    const entering = rows.filter(
      (row) =>
        wordsOf(row.title).includes(word) &&
        trial.isSelected(trial.score({ ...row, description: row.description ?? undefined })),
    ).length;
    suggestions.push({ word, postings, entering });
  }
  return suggestions.toSorted((a, b) => b.entering - a.entering || b.postings - a.postings).slice(0, 10);
}
