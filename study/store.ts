import { eq } from '../../apps/server/src/core/module-db.ts';
import type { Db } from '../../apps/server/src/db/index.ts';
import type { StudyPlan } from './plan.ts';
import { days, plans } from './schema.ts';

/** Adds the plan to the active ones (decision 15); a new version replaces its days and keeps its progress. */
export function savePlan(db: Db, plan: StudyPlan) {
  const { days: entries, ...header } = plan;
  db.transaction((tx) => {
    tx.insert(plans)
      .values({ id: plan.id, version: plan.version, header: JSON.stringify(header), active: true })
      .onConflictDoUpdate({
        target: plans.id,
        set: { version: plan.version, header: JSON.stringify(header), active: true },
      })
      .run();
    tx.delete(days).where(eq(days.planId, plan.id)).run();
    for (const [position, day] of entries.entries()) {
      tx.insert(days)
        .values({ planId: plan.id, id: day.id, position, data: JSON.stringify(day) })
        .run();
    }
  });
}
