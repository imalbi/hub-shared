import { and, eq, inArray } from '../../apps/server/src/core/module-db.ts';
import type { Db } from '../../apps/server/src/db/index.ts';
import { z } from '../../apps/server/src/core/module.ts';
import { planShape } from './plan.ts';
import { activeHeaders, dayKey, readIndex } from './read.ts';
import { days, progress } from './schema.ts';

const dayShape = planShape.shape.days.element;
export const causes = ['concept', 'model', 'step', 'calculation', 'unit', 'reading', 'memory', 'time'] as const;
export const results = ['solved', 'again'] as const;

/** What one `progress` row of kind `error` holds (decision 8): the id of the row is the entry's id. */
const stored = z.object({
  day: z.string(),
  reference: z.string(),
  tried: z.string(),
  cause: z.enum(causes),
  method: z.string(),
  retry: z.string().nullable(),
  result: z.enum(results).nullable(),
});

export const errorInput = z.object({
  /** Day key `<planId>/<dayId>`. */
  key: z.string(),
  /** Present when editing an entry. */
  id: z.string().optional(),
  reference: z.string().trim().min(1).max(500),
  tried: z.string().max(5000).default(''),
  cause: z.enum(causes),
  method: z.string().max(5000).default(''),
  /** Day key to retry on. */
  retry: z.string().nullable().default(null),
  result: z.enum(results).nullable().default(null),
});

export type ErrorEntry = ReturnType<typeof readErrors>[number];

export const serializeError = (input: z.infer<typeof errorInput>, dayId: string) =>
  JSON.stringify(
    stored.parse({
      day: dayId,
      reference: input.reference,
      tried: input.tried,
      cause: input.cause,
      method: input.method,
      retry: input.retry,
      result: input.result,
    }),
  );

export function readErrors(db: Db, planIds?: string[]) {
  const ids = planIds ?? activeHeaders(db).map((header) => header.id);
  if (!ids.length) return [];
  return db
    .select()
    .from(progress)
    .where(and(inArray(progress.planId, ids), eq(progress.kind, 'error')))
    .orderBy(progress.id)
    .all()
    .map((row) => {
      const { day, ...entry } = stored.parse(JSON.parse(row.value));
      return { id: row.id, planId: row.planId, key: dayKey(row.planId, day), ...entry };
    });
}

/** Threads still red or yellow with their days, and the days left half done with their open steps (step 43). */
export function readReview(db: Db) {
  const index = readIndex(db);
  const headers = activeHeaders(db);
  if (!index) return { threads: [], half: [] };
  const rows = db
    .select()
    .from(days)
    .where(
      inArray(
        days.planId,
        headers.map((header) => header.id),
      ),
    )
    .all();
  const records = db
    .select()
    .from(progress)
    .where(
      inArray(
        progress.planId,
        headers.map((header) => header.id),
      ),
    )
    .all();
  const value = (planId: string, kind: string, id: string) =>
    records.find((record) => record.planId === planId && record.kind === kind && record.id === id)?.value;
  // shortcut: parses every day of the active plans per request; fine for hundreds of days, cache by version beyond that.
  const bodies = new Map(rows.map((row) => [dayKey(row.planId, row.id), dayShape.parse(JSON.parse(row.data))]));
  const threads = headers.flatMap((header) =>
    header.threads.flatMap((thread) => {
      const autonomy = value(header.id, 'autonomy', thread.id);
      if (autonomy !== 'red' && autonomy !== 'yellow') return [];
      const entries = index.days
        .filter((day) => bodies.get(day.key)?.threads.includes(thread.id))
        .map((day) => ({ key: day.key, g: day.g, title: day.title, done: day.done }));
      return [{ planId: header.id, id: thread.id, title: thread.title, value: autonomy, days: entries }];
    }),
  );
  threads.sort((a, b) => Number(b.value === 'red') - Number(a.value === 'red'));
  const half = index.days.flatMap((day) => {
    const steps = bodies.get(day.key)?.blocks.flatMap((block) => block.steps) ?? [];
    const open = steps.filter((step) => value(day.planId, 'step', step.id) !== 'done');
    if (day.done || !steps.length || open.length === steps.length) return [];
    return [
      {
        key: day.key,
        planId: day.planId,
        g: day.g,
        title: day.title,
        subject: day.subject,
        total: steps.length,
        open: open.map((step) => ({ id: step.id, text: step.text })),
      },
    ];
  });
  return { threads, half };
}
