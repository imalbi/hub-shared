import { and, eq, inArray, sql } from '../../apps/server/src/core/module-db.ts';
import type { Db } from '../../apps/server/src/db/index.ts';
import { fold } from '../../apps/server/src/core/fold.ts';
import { z } from '../../apps/server/src/core/module.ts';
import { effectiveMix, orderDays } from './order.ts';
import { planShape } from './plan.ts';
import { days, plans, preferences, progress } from './schema.ts';

const dayShape = planShape.shape.days.element;
const headerShape = planShape.omit({ days: true });
const mixShape = z.record(z.string(), z.number());
/** The preferences row of the mix and weekly hours, shared by every active plan (decision 15). */
export const GLOBAL = '*';

/** `<planId>:<subjectId>`: a subject across plans, the key of states and shares. */
export const subjectKey = (planId: string, subject: string) => `${planId}:${subject}`;
/** `<planId>/<dayId>`: a day across plans. */
export const dayKey = (planId: string, day: string) => `${planId}/${day}`;

export function activeHeaders(db: Db) {
  return db
    .select()
    .from(plans)
    .where(eq(plans.active, true))
    .orderBy(plans.id)
    .all()
    .map((row) => headerShape.parse(JSON.parse(row.header)));
}

export function readIndex(db: Db) {
  const headers = activeHeaders(db);
  if (!headers.length) return null;
  const ids = headers.map((header) => header.id);
  const settings = db.select().from(preferences).where(eq(preferences.planId, GLOBAL)).get();
  const entries = db
    .select({
      planId: days.planId,
      id: days.id,
      position: days.position,
      subject: sql<string>`json_extract(${days.data}, '$.subject')`,
      title: sql<string>`json_extract(${days.data}, '$.title')`,
      phase: sql<string | null>`json_extract(${days.data}, '$.phase')`,
      kind: sql<'study' | 'mock' | 'review'>`json_extract(${days.data}, '$.kind')`,
      minutes: sql<number | null>`json_extract(${days.data}, '$.minutes')`,
    })
    .from(days)
    .where(inArray(days.planId, ids))
    .orderBy(days.planId, days.position)
    .all();
  const records = db.select().from(progress).where(inArray(progress.planId, ids)).all();
  const states = Object.fromEntries(
    records.filter((item) => item.kind === 'subject').map((item) => [subjectKey(item.planId, item.id), item.value]),
  );
  const done = new Set(
    records.filter((item) => item.kind === 'day' && item.value === 'done').map((item) => dayKey(item.planId, item.id)),
  );
  // When a day was completed (ISO, empty once reopened): the calendar anchors a done day there (step 55).
  const doneAt = new Map(
    records
      .filter((item) => item.kind === 'doneAt' && item.value)
      .map((item) => [dayKey(item.planId, item.id), item.value]),
  );
  const subjects = headers.flatMap((header) => header.subjects.map((item) => subjectKey(header.id, item.id)));
  const stored = settings?.mix ? mixShape.parse(JSON.parse(settings.mix)) : null;
  // A stored mix counts only while it names every active subject: a new plan or subject falls back to equal shares.
  const complete = stored && subjects.every((key) => key in stored) ? stored : null;
  const raw =
    complete ?? (headers.length > 1 ? Object.fromEntries(subjects.map((key) => [key, 100 / subjects.length])) : null);
  const mix = raw ? effectiveMix(Object.fromEntries(subjects.map((key) => [key, raw[key] ?? 0])), states) : null;
  const rows = entries.map((day) => ({
    ...day,
    key: dayKey(day.planId, day.id),
    subject: subjectKey(day.planId, day.subject),
    minutes: day.minutes ?? undefined,
    done: done.has(dayKey(day.planId, day.id)),
    doneAt: done.has(dayKey(day.planId, day.id)) ? (doneAt.get(dayKey(day.planId, day.id)) ?? null) : null,
  }));
  const ordered = orderDays(rows, states, mix);
  const shown = new Set(ordered.map((day) => day.key));
  const selected = db
    .select()
    .from(progress)
    .where(and(eq(progress.planId, GLOBAL), eq(progress.kind, 'current')))
    .get();
  const current =
    ordered.find(
      (day) => day.key === selected?.value && states[day.subject] !== 'paused' && states[day.subject] !== 'passed',
    ) ?? ordered.find((day) => !day.done);
  return {
    planIds: ids,
    states,
    mix,
    mixSet: complete !== null,
    current: current?.key ?? null,
    weeklyHours:
      settings?.weeklyHours === null || settings?.weeklyHours === undefined ? null : settings.weeklyHours / 60,
    days: ordered.map((day, index) => ({ ...day, g: index + 1 })),
    hiddenDays: rows.filter((day) => !shown.has(day.key)).map((day) => ({ ...day, g: null })),
  };
}

type Entry = NonNullable<ReturnType<typeof readIndex>>['days' | 'hiddenDays'][number];

export function readDays(db: Db, offset: number, limit: number) {
  const index = readIndex(db);
  return index ? readSelected(db, index.days.slice(offset, offset + limit)) : [];
}

export function readDaysById(db: Db, keys: string[]) {
  const index = readIndex(db);
  if (!index) return [];
  const requested = new Set(keys);
  return readSelected(
    db,
    [...index.days, ...index.hiddenDays].filter((day) => requested.has(day.key)),
  );
}

function readSelected(db: Db, selected: Entry[]) {
  if (!selected.length) return [];
  const rows = [...new Set(selected.map((day) => day.planId))].flatMap((planId) =>
    db
      .select()
      .from(days)
      .where(
        and(
          eq(days.planId, planId),
          inArray(
            days.id,
            selected.filter((day) => day.planId === planId).map((day) => day.id),
          ),
        ),
      )
      .all(),
  );
  const byKey = new Map(rows.map((row) => [dayKey(row.planId, row.id), dayShape.parse(JSON.parse(row.data))]));
  return selected.flatMap((item) => {
    const day = byKey.get(item.key);
    return day ? [{ ...day, key: item.key, planId: item.planId, g: item.g, done: item.done }] : [];
  });
}

/** At most this many rows of a palette search; `total` counts every match. */
export const SEARCH_ROWS = 3;

/**
 * Days whose title holds the query (case and accents ignored), from the index only: no day body is read. Paused
 * subjects' days are found too (they have no G number).
 */
export function searchDays(db: Db, query: string) {
  const index = readIndex(db);
  if (!index) return { total: 0, rows: [] };
  const needle = fold(query);
  const found = [...index.days, ...index.hiddenDays].filter((day) => fold(day.title).includes(needle));
  return {
    total: found.length,
    rows: found
      .slice(0, SEARCH_ROWS)
      .map((day) => ({ key: day.key, g: day.g, title: day.title, subject: day.subject, done: day.done })),
  };
}
