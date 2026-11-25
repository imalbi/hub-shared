import { and, eq, gt, inArray, or, sql } from '../../apps/server/src/core/module-db.ts';
import type { Db } from '../../apps/server/src/db/index.ts';
import { firstMatchingRule, type BlacklistRule } from './blacklist.ts';
import type { Profile } from './config.ts';
import { comparisonCompany, comparisonKey, postingKey } from './key.ts';
import { isNearMiss, nearMissTextLimit, trimNearMisses } from './near-miss.ts';
import { blacklistRules, jobs, knownUrls, nearMisses, purgedJobs } from './schema.ts';
import type { createScorer } from './score.ts';
import type { Card, Source, SourceContext } from './source.ts';
import type { WorkMode } from './work-mode.ts';

// What happens to the cards of one finished search, in the order of the reference ("Flusso di una raccolta", step
// 4). Everything that waits (descriptions) happens first; the last part is synchronous, because the driver's
// transactions are, and it re-reads history and rules right before writing, so searches that finish together on
// different sites cannot both save the same posting.

const day = 86_400_000;

/** What the state shows of a posting a dry run would save, and what the notification lists. */
export type DryRunRow = {
  title: string;
  company: string;
  location: string;
  site: string;
  url: string;
  score: number;
  total: number;
  reasons: string[];
  categories: string[];
  workMode: WorkMode | null;
  postedAt: string | null;
  missing: boolean;
};
export type Selected = DryRunRow & { at: number };

export type IngestContext = {
  db: Db;
  scorer: ReturnType<typeof createScorer>;
  profile: Profile;
  source: Source | undefined;
  sourceContext: SourceContext;
  now: () => number;
  signal: AbortSignal;
  /** A dry run reads everything and writes nothing. */
  dryRun: boolean;
  /** Blocked companies in comparison form. */
  blocked: ReadonlySet<string>;
  /** Shared by every search of the collection: URLs met and comparison keys already taken. */
  seen: Set<string>;
  claimed: Set<string>;
};

type Item = {
  card: Card;
  key: string;
  cmp: string;
  description: string | undefined;
  descriptionHtml: string | undefined;
  /** The description was asked for and did not come: saved as it is, judged again next time. */
  missing: boolean;
  /** Matched a rule before any description was fetched. */
  early: boolean;
};

/** Best first: by total, then by the date of the posting. */
export const rank = (rows: Selected[]) => rows.toSorted((a, b) => b.total - a.total || b.at - a.at);

/** Numbers about one search, for the log and the calibration of a profile: never a title or a link. */
export type SearchCounts = {
  read: number;
  fresh: number;
  /** Published more than `filter.maxAgeDays` ago. */
  tooOld: number;
  outsideLocation: number;
  lowTitle: number;
  /** Stabile postings dropped for what they require (degree, health qualification, licence, configured phrase). */
  excludedRequirement: number;
};

const nothing = { selected: [] as Selected[], excluded: 0, requirements: {} as Record<string, number> };

function readRules(db: Db): BlacklistRule[] {
  return db.select().from(blacklistRules).where(eq(blacklistRules.enabled, true)).all();
}

function readHistory(db: Db, items: readonly Item[]) {
  const rows = db
    .select({
      key: jobs.key,
      comparisonKey: jobs.comparisonKey,
      url: jobs.url,
      blacklistRule: jobs.blacklistRule,
      detailsMissing: jobs.detailsMissing,
      firstSeen: jobs.firstSeen,
    })
    .from(jobs)
    .where(
      or(
        inArray(
          jobs.url,
          items.map((i) => i.card.url),
        ),
        inArray(
          jobs.comparisonKey,
          items.map((i) => i.cmp),
        ),
      ),
    )
    .all();
  const purged = db
    .select({ key: purgedJobs.key })
    .from(purgedJobs)
    .where(
      inArray(
        purgedJobs.key,
        items.map((i) => i.key),
      ),
    )
    .all();
  return {
    byUrl: new Map(rows.map((row) => [row.url, row])),
    byComparison: new Map(rows.map((row) => [row.comparisonKey, row])),
    purged: new Set(purged.map((row) => row.key)),
  };
}

export function createKnown(db: Db, knownDays: number, now: () => number) {
  /** True for a URL saved in `jobs` or judged within `knownDays`; 0 days switches the cache off. */
  return (url: string) => {
    const saved = db.select({ detailsMissing: jobs.detailsMissing }).from(jobs).where(eq(jobs.url, url)).get();
    if (saved) return !saved.detailsMissing;
    if (knownDays === 0) return false;
    const since = new Date(now() - knownDays * day);
    return Boolean(
      db
        .select({ url: knownUrls.url })
        .from(knownUrls)
        .where(and(eq(knownUrls.url, url), gt(knownUrls.seenAt, since)))
        .get(),
    );
  };
}

export async function ingestSearch(ctx: IngestContext, cards: readonly Card[]) {
  const { db, profile, scorer, signal } = ctx;
  const { filter, search } = profile;
  const counts: SearchCounts = {
    read: cards.length,
    fresh: 0,
    tooOld: 0,
    outsideLocation: 0,
    lowTitle: 0,
    excludedRequirement: 0,
  };
  const empty = { ...nothing, counts };

  // 1. Urls met in this collection, then urls judged within `knownDays` (0 switches the cache off).
  const since = new Date(ctx.now() - search.knownDays * day);
  const urls = cards.map((card) => card.url);
  const cached =
    search.knownDays > 0 && urls.length
      ? new Set(
          db
            .select({ url: knownUrls.url })
            .from(knownUrls)
            .where(and(inArray(knownUrls.url, urls), gt(knownUrls.seenAt, since)))
            .all()
            .map((row) => row.url),
        )
      : new Set<string>();
  const items: Item[] = [];
  const isKnown = createKnown(db, search.knownDays, ctx.now);
  for (const card of cards) {
    if (ctx.seen.has(card.url)) continue;
    ctx.seen.add(card.url);
    if (cached.has(card.url) && isKnown(card.url)) continue;
    items.push({
      card,
      key: postingKey(card.company, card.title),
      cmp: comparisonKey(card.company, card.title, card.location),
      description: card.description?.trim() || undefined,
      descriptionHtml: card.descriptionHtml,
      missing: card.detailsMissing === true,
      early: false,
    });
  }
  if (!items.length) return empty;
  counts.fresh = items.length;

  // 2. No-network filters. A posting that only a rule keeps out skips the description fetch but is still saved.
  const rules = readRules(db);
  const history = readHistory(db, items);
  const candidates: Item[] = [];
  const early: Item[] = [];
  const dropped: string[] = [];
  for (const item of items) {
    const { card } = item;
    const saved = [history.byUrl.get(card.url), history.byComparison.get(item.cmp)];
    const known =
      saved.some(
        (row) =>
          row && row.blacklistRule === null && (!row.detailsMissing || (!item.description && !ctx.source?.describe)),
      ) ||
      ctx.claimed.has(item.cmp) ||
      history.purged.has(item.key) ||
      ctx.blocked.has(comparisonCompany(card.company));
    if (!known && saved.some((row) => row?.detailsMissing && row.blacklistRule === null)) {
      candidates.push(item);
      continue;
    }
    const couldBeRemote =
      !item.description &&
      ctx.source?.describe !== undefined &&
      scorer.passesLocation({ ...card, declaredMode: 'remote' });
    const outside = !scorer.passesLocation(card) && !couldBeRemote;
    // A Stabile card is not judged on its title. What the card carries is all that is known before the fetch: a
    // contract phrase counts only when the listing already gave a description (Indeed), otherwise the card enters
    // through its company or its source.
    const lowTitle =
      scorer.scoreTitle(card.title).score < filter.minTitleScore &&
      !scorer.isStable({ ...card, description: item.description });
    const tooOld = card.postedAt !== undefined && card.postedAt.getTime() < ctx.now() - filter.maxAgeDays * day;
    if (known || tooOld || outside || lowTitle) {
      dropped.push(card.url);
      // Counted once, by the first reason that is about the posting itself.
      if (!known) counts[tooOld ? 'tooOld' : outside ? 'outsideLocation' : 'lowTitle']++;
      continue;
    }
    const view = { ...card, key: item.key, work_mode: card.declaredMode ?? null, description: item.description };
    // It is saved without its text: marked incomplete when the source could have given it.
    if (firstMatchingRule(rules, view))
      early.push({
        ...item,
        early: true,
        missing: item.missing || (!item.description && ctx.source?.describe !== undefined),
      });
    else candidates.push(item);
  }

  // 3. Missing descriptions, best title first: when a source's budget runs out the best postings already have theirs.
  const describe = ctx.source?.describe;
  if (describe) {
    const wanted = candidates
      .filter((item) => !item.description)
      .toSorted((a, b) => scorer.scoreTitle(b.card.title).score - scorer.scoreTitle(a.card.title).score);
    for (const item of wanted) {
      if (signal.aborted) return empty;
      try {
        const result = await describe(item.card, ctx.sourceContext);
        item.description = (typeof result === 'string' ? result : result.text).trim() || undefined;
        if (typeof result !== 'string') item.descriptionHtml = result.html;
      } catch {
        // The reason stays with the source; the posting only needs to know it is incomplete.
      }
      item.missing = !item.description;
    }
  }
  if (signal.aborted) return empty;

  const eligible: Item[] = [];
  for (const item of [...early, ...candidates]) {
    const recovering =
      history.byUrl.get(item.card.url)?.detailsMissing || history.byComparison.get(item.cmp)?.detailsMissing;
    if (!recovering && !scorer.passesLocation({ ...item.card, description: item.description })) {
      counts.outsideLocation++;
      if (!item.missing) dropped.push(item.card.url);
    } else eligible.push(item);
  }
  const committed = commit(ctx, eligible, dropped);
  counts.excludedRequirement = Object.values(committed.requirements).reduce((sum, n) => sum + n, 0);
  return { ...committed, counts };
}

/** 4 and 5: history and rules read again, everything applied, one synchronous transaction. */
function commit(ctx: IngestContext, items: readonly Item[], dropped: readonly string[]) {
  const { db, profile, scorer } = ctx;
  const nowMs = ctx.now();
  const rules = readRules(db);
  const history = readHistory(db, items);
  const selected: Selected[] = [];
  const inserts: Array<typeof jobs.$inferInsert> = [];
  const replaces: Array<{ key: string; row: typeof jobs.$inferInsert }> = [];
  const repairs: Array<{ key: string; row: Partial<typeof jobs.$inferInsert> }> = [];
  const judged = [...dropped];
  const misses: Array<typeof nearMisses.$inferInsert> = [];
  let excluded = 0;
  /** Stabile postings dropped for what they require, by reason (`laurea`, `sanitario`, `patente`, `altro`). */
  const requirements: Record<string, number> = {};

  for (const item of items) {
    const { card } = item;
    const saved = [history.byUrl.get(card.url), history.byComparison.get(item.cmp)].filter((row) => row !== undefined);
    if (ctx.claimed.has(item.cmp) || history.purged.has(item.key) || ctx.blocked.has(comparisonCompany(card.company)))
      continue;
    const existing = saved.find((row) => row.blacklistRule === null) ?? saved[0];
    const result = scorer.score({ ...card, description: item.description });
    if (existing?.blacklistRule === null) {
      if (existing.detailsMissing && !item.missing && item.description) {
        repairs.push({
          key: existing.key,
          row: {
            description: item.description,
            descriptionHtml: item.descriptionHtml ?? null,
            detailsMissing: false,
            score: result.score,
            total: result.total,
            reasons: result.reasons,
            categories: scorer.categories({ ...card, description: item.description }),
            workMode: result.workMode,
            isRemote: result.workMode === 'remote',
          },
        });
        ctx.claimed.add(item.cmp);
        judged.push(card.url);
      } else if (!existing.detailsMissing) judged.push(card.url);
      continue;
    }
    const isSelected = scorer.isSelected(result);
    const rule = firstMatchingRule(rules, {
      ...card,
      key: item.key,
      description: item.description,
      work_mode: result.workMode,
    });
    // A rule excludes what would otherwise be a posting of the list; one that matched before the fetch is kept as is.
    const excludedRow = rule !== undefined && (isSelected || item.early);
    if (!excludedRow && !isSelected) {
      for (const reason of result.reasons)
        if (reason.startsWith('escluso:'))
          requirements[reason.slice('escluso:'.length)] = (requirements[reason.slice('escluso:'.length)] ?? 0) + 1;
      // Judged on a title alone, or missing its text: looked at again next time, not remembered.
      if (!item.missing && !item.early) judged.push(card.url);
      // Only a posting the score gates alone refused, with its text: what the owner may want to add (step 77).
      if (!item.missing && !item.early && !existing && rule === undefined && isNearMiss(result, profile.filter))
        misses.push({
          key: item.key,
          url: card.url,
          title: card.title,
          company: card.company,
          location: card.location,
          site: card.site,
          score: result.score,
          titleScore: result.titleScore,
          total: result.total,
          reasons: result.reasons,
          minScore: profile.filter.minScore,
          minTitleScore: profile.filter.minTitleScore,
          description: item.description?.slice(0, nearMissTextLimit) ?? null,
          firstSeen: new Date(nowMs),
          lastSeen: new Date(nowMs),
        });
      continue;
    }
    ctx.claimed.add(item.cmp);
    if (excludedRow && existing) continue; // an excluded row already saved stays exactly as it is
    if (!excludedRow && !item.missing) judged.push(card.url);
    const row: typeof jobs.$inferInsert = {
      // The key of a row that is replaced never changes.
      key: existing?.key ?? item.key,
      comparisonKey: item.cmp,
      title: card.title,
      company: card.company,
      location: card.location,
      site: card.site,
      url: card.url,
      applyUrl: card.applyUrl ?? null,
      score: result.score,
      total: result.total,
      reasons: result.reasons,
      categories: scorer.categories({ ...card, description: item.description }),
      description: item.description ?? null,
      descriptionHtml: item.description ? (item.descriptionHtml ?? null) : null,
      workMode: result.workMode,
      isRemote: result.workMode === 'remote',
      detailsMissing: item.missing,
      postedAt: card.postedAt ?? null,
      firstSeen: existing?.firstSeen ?? new Date(nowMs),
      importedAt: null,
      blacklistRule: excludedRow ? rule.id : null,
    };
    if (existing) replaces.push({ key: existing.key, row });
    else inserts.push(row);
    if (excludedRow) {
      excluded++;
      continue;
    }
    selected.push({
      title: card.title,
      company: card.company,
      location: card.location,
      site: card.site,
      url: card.url,
      score: result.score,
      total: result.total,
      reasons: result.reasons,
      categories: row.categories,
      workMode: result.workMode,
      postedAt: card.postedAt ? card.postedAt.toISOString() : null,
      missing: item.missing,
      at: card.postedAt?.getTime() ?? nowMs,
    });
  }

  if (!ctx.dryRun) {
    // shortcut: one statement per search is fine up to the variable limit of SQLite (tens of thousands of urls).
    const cache = profile.search.knownDays > 0 ? judged.map((url) => ({ url, seenAt: new Date(nowMs) })) : [];
    db.transaction((tx) => {
      // Updated in place: a delete would cascade to the saved Parere and bando text.
      for (const { key, row } of repairs) tx.update(jobs).set(row).where(eq(jobs.key, key)).run();
      for (const { key, row } of replaces) tx.update(jobs).set(row).where(eq(jobs.key, key)).run();
      for (const row of inserts) tx.insert(jobs).values(row).run();
      // A posting that entered the list is no near miss any more.
      const entered = [...inserts, ...replaces.map((r) => r.row)].map((row) => row.key);
      if (entered.length) tx.delete(nearMisses).where(inArray(nearMisses.key, entered)).run();
      for (const miss of misses) {
        const { firstSeen: _kept, ...refreshed } = miss;
        tx.insert(nearMisses).values(miss).onConflictDoUpdate({ target: nearMisses.key, set: refreshed }).run();
      }
      trimNearMisses(tx, nowMs);
      if (cache.length)
        tx.insert(knownUrls)
          .values(cache)
          .onConflictDoUpdate({ target: knownUrls.url, set: { seenAt: sql`excluded.seen_at` } })
          .run();
    });
  }
  return { selected, excluded, requirements };
}
