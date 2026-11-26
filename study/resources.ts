import { randomUUID } from 'node:crypto';
import { and, eq } from '../../apps/server/src/core/module-db.ts';
import { TRPCError, z } from '../../apps/server/src/core/module.ts';
import type { Db } from '../../apps/server/src/db/index.ts';
import { resolveMaterial } from './library.ts';
import { planShape } from './plan.ts';
import { plans, resources } from './schema.ts';

export const resourceScope = z.object({ planId: z.string().min(1), subjectId: z.string().min(1) });
export const resourceRevision = z.object({ id: z.string().min(1), revision: z.int().positive() });
const identity = z.union([
  resourceRevision,
  z.object({ id: z.undefined().optional(), revision: z.undefined().optional() }),
]);
const fields = resourceScope.extend({ title: z.string().trim().min(1).max(200), pinned: z.boolean().optional() });
const target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('note'), body: z.string().max(100000) }),
  z.object({
    kind: z.literal('link'),
    url: z
      .string()
      .trim()
      .max(2048)
      .refine((value) => URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol)),
  }),
  z.object({
    kind: z.literal('pdf'),
    path: z.string().min(1),
    folder: z.int().nonnegative(),
    page: z.int().positive().optional(),
  }),
]);
export const resourceInput = z.intersection(z.intersection(fields, identity), target);
const headerShape = planShape.omit({ days: true });

export function resourceSubjects(db: Db) {
  return db
    .select()
    .from(plans)
    .orderBy(plans.id)
    .all()
    .flatMap((row) => {
      const header = headerShape.parse(JSON.parse(row.header));
      return header.subjects.map((subject) => ({
        planId: row.id,
        id: subject.id,
        key: `${row.id}:${subject.id}`,
        label: `${header.title} · ${subject.name}`,
      }));
    });
}

export function readResources(db: Db, scope: z.infer<typeof resourceScope>) {
  return db
    .select()
    .from(resources)
    .where(and(eq(resources.planId, scope.planId), eq(resources.subjectId, scope.subjectId)))
    .orderBy(resources.position)
    .all();
}

function observedResource(db: Pick<Db, 'select'>, input: z.infer<typeof resourceRevision>) {
  const row = db.select().from(resources).where(eq(resources.id, input.id)).get();
  if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
  if (row.revision !== input.revision)
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Il materiale è stato modificato. Ricarica dal server o sovrascrivi usando la versione corrente.',
    });
  return row;
}

export async function saveResource(db: Db, dirs: string[], input: z.infer<typeof resourceInput>) {
  if (!resourceSubjects(db).some((subject) => subject.planId === input.planId && subject.id === input.subjectId))
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'Materia sconosciuta' });
  if (input.kind === 'pdf') await resolveMaterial(dirs, input.path, input.folder);
  // PDF validation awaits filesystem IO; revision checks and writes must stay together afterwards.
  return db.transaction((tx) => {
    const previous = input.id ? observedResource(tx, { id: input.id, revision: input.revision }) : undefined;
    if (previous && (previous.planId !== input.planId || previous.subjectId !== input.subjectId))
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'La materia del materiale non può cambiare' });
    const values = {
      planId: input.planId,
      subjectId: input.subjectId,
      title: input.title,
      kind: input.kind,
      body: input.kind === 'note' ? input.body : '',
      url: input.kind === 'link' ? input.url : '',
      path: input.kind === 'pdf' ? input.path : '',
      folder: input.kind === 'pdf' ? input.folder : null,
      page: input.kind === 'pdf' ? (input.page ?? null) : null,
      pinned: input.pinned ?? previous?.pinned ?? false,
      revision: (previous?.revision ?? 0) + 1,
    };
    const id = previous?.id ?? randomUUID();
    if (previous) tx.update(resources).set(values).where(eq(resources.id, id)).run();
    else
      tx.insert(resources)
        .values({ id, ...values })
        .run();
    return { id, ...values };
  });
}

export function setResourcePinned(db: Db, input: z.infer<typeof resourceRevision> & { pinned: boolean }) {
  return db.transaction((tx) => {
    const row = observedResource(tx, input);
    tx.update(resources)
      .set({ pinned: input.pinned, revision: row.revision + 1 })
      .where(eq(resources.id, input.id))
      .run();
  });
}

export function deleteResource(db: Db, input: z.infer<typeof resourceRevision>) {
  return db.transaction((tx) => {
    observedResource(tx, input);
    tx.delete(resources).where(eq(resources.id, input.id)).run();
  });
}
