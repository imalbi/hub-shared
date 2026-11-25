import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from '../../apps/server/src/core/module-db.ts';
import type { FocusHistory } from '../../apps/server/src/core/focus-history.ts';
import type { Db } from '../../apps/server/src/db/index.ts';
import { planShape } from './plan.ts';
import { readErrors } from './errors.ts';
import { readIndex } from './read.ts';
import { days, plans, progress } from './schema.ts';

export function createStateWriter(db: Db, root: string, onError: (error: unknown) => void, focusHistory: FocusHistory) {
  const dirty = new Set<string>();
  let timer: NodeJS.Timeout | undefined;
  let pending: Promise<void> = Promise.resolve();
  let lastWrite = 0;

  async function write(planId: string) {
    const row = db.select().from(plans).where(eq(plans.id, planId)).get();
    if (!row) return;
    const header = planShape.omit({ days: true }).parse(JSON.parse(row.header));
    const entries = db
      .select()
      .from(days)
      .where(eq(days.planId, planId))
      .all()
      .map((item) => planShape.shape.days.element.parse(JSON.parse(item.data)));
    const records = db.select().from(progress).where(eq(progress.planId, planId)).all();
    const get = (kind: string, id: string) => records.find((record) => record.kind === kind && record.id === id)?.value;
    const known: Record<string, Set<string>> = {
      step: new Set(entries.flatMap((day) => day.blocks.flatMap((block) => block.steps.map((step) => step.id)))),
      day: new Set(entries.map((day) => day.id)),
      thread: new Set(header.threads.map((thread) => thread.id)),
      subject: new Set(header.subjects.map((subject) => subject.id)),
    };
    const current = readIndex(db)?.current;
    const minutes = focusHistory.minutesByTag(`study/${planId}/`);
    const state = {
      planId,
      version: header.version,
      currentDay: current?.startsWith(`${planId}/`) ? current.slice(planId.length + 1) : null,
      days: entries.map((day) => ({
        id: day.id,
        minutes: minutes[`study/${planId}/${day.id}`] ?? 0,
        done: get('day', day.id) === 'done',
        doneAt: get('day', day.id) === 'done' ? get('doneAt', day.id) || null : null,
        note: get('note', day.id) ?? '',
        openSteps: day.blocks.flatMap((block) =>
          block.steps.filter((step) => get('step', step.id) !== 'done').map((step) => step.id),
        ),
      })),
      autonomy: Object.fromEntries(header.threads.map((thread) => [thread.id, get('autonomy', thread.id) ?? 'unset'])),
      subjects: Object.fromEntries(
        header.subjects.map((subject) => [subject.id, get('subject', subject.id) ?? 'active']),
      ),
      errors: readErrors(db, [planId]).map(({ id, planId: _plan, key, ...entry }) => ({
        id,
        day: key.slice(planId.length + 1),
        ...entry,
      })),
      removed: records.filter((record) => {
        const kind =
          record.kind === 'note' || record.kind === 'doneAt'
            ? 'day'
            : record.kind === 'autonomy'
              ? 'thread'
              : record.kind;
        return known[kind] && !known[kind].has(record.id);
      }),
    };
    const dir = join(root, 'stato');
    await mkdir(dir, { recursive: true });
    const temp = join(dir, `.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`);
      await rename(temp, join(dir, `${header.id}.json`));
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
  }

  function flush() {
    timer = undefined;
    const ids = [...dirty];
    dirty.clear();
    pending = pending.then(async () => {
      const wait = Math.max(0, 1000 - (Date.now() - lastWrite));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      for (const id of ids) {
        try {
          await write(id);
        } catch (error) {
          onError(error);
        }
      }
      lastWrite = Date.now();
    });
  }
  return {
    schedule(id: string) {
      if (!root) return;
      dirty.add(id);
      timer ??= setTimeout(flush, Math.max(0, 1000 - (Date.now() - lastWrite)));
    },
    async close() {
      if (timer) {
        clearTimeout(timer);
        flush();
      }
      await pending;
    },
  };
}
