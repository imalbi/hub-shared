import { randomUUID } from 'node:crypto';
import { eq } from '../../apps/server/src/core/module-db.ts';
import { TRPCError, z } from '../../apps/server/src/core/module.ts';
import type { Db } from '../../apps/server/src/db/index.ts';
import { learningBacklog } from './schema.ts';

export const backlogStatus = z.enum(['todo', 'active', 'completed']);
export const backlogInput = z.object({
  id: z.string().min(1).optional(),
  title: z.string().trim().min(1).max(200),
  note: z.string().trim().max(1000).default(''),
  url: z
    .string()
    .trim()
    .max(2048)
    .refine((value) => {
      if (!value) return true;
      return URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol);
    })
    .default(''),
  status: backlogStatus.default('todo'),
});

export function readBacklog(db: Db) {
  return db.select().from(learningBacklog).orderBy(learningBacklog.position).all();
}

export function saveBacklog(db: Db, input: z.infer<typeof backlogInput>) {
  const { id, ...values } = input;
  if (id) {
    const result = db.update(learningBacklog).set(values).where(eq(learningBacklog.id, id)).run();
    if (!result.changes) throw new TRPCError({ code: 'NOT_FOUND' });
    return { id };
  }
  const generated = randomUUID();
  db.insert(learningBacklog)
    .values({ id: generated, ...values })
    .run();
  return { id: generated };
}

export function setBacklogStatus(db: Db, id: string, status: z.infer<typeof backlogStatus>) {
  const result = db.update(learningBacklog).set({ status }).where(eq(learningBacklog.id, id)).run();
  if (!result.changes) throw new TRPCError({ code: 'NOT_FOUND' });
}

export function deleteBacklog(db: Db, id: string) {
  const result = db.delete(learningBacklog).where(eq(learningBacklog.id, id)).run();
  if (!result.changes) throw new TRPCError({ code: 'NOT_FOUND' });
}
