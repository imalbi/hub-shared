import { and, eq, isNull } from '../../apps/server/src/core/module-db.ts';
import type { Db } from '../../apps/server/src/db/index.ts';
import { jobApplied, jobArchive, jobDeleted, jobs } from './schema.ts';

/**
 * A source that read its whole listing proves that a posting it no longer lists is closed: archive the ones still
 * waiting in Da valutare. Applied, deleted, archived and blacklisted postings are the owner's (or a rule's) already.
 */
export function archiveGone(db: Db, site: string, listed: ReadonlySet<string>, at: Date): number {
  const taken = new Set([
    ...db
      .select({ key: jobArchive.key })
      .from(jobArchive)
      .all()
      .map((row) => row.key),
    ...db
      .select({ key: jobDeleted.key })
      .from(jobDeleted)
      .all()
      .map((row) => row.key),
    ...db
      .select({ key: jobApplied.key })
      .from(jobApplied)
      .all()
      .map((row) => row.key),
  ]);
  const gone = db
    .select({ key: jobs.key, url: jobs.url })
    .from(jobs)
    .where(and(eq(jobs.site, site), isNull(jobs.blacklistRule)))
    .all()
    .filter((row) => !listed.has(row.url) && !taken.has(row.key));
  for (const { key } of gone) db.insert(jobArchive).values({ key, at }).onConflictDoNothing().run();
  return gone.length;
}
