import { isAbsolute } from 'node:path';
import { z } from '../../apps/server/src/core/module.ts';

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/);
const step = z.strictObject({
  id,
  text: z.string().min(1),
  file: z.strictObject({ path: z.string().min(1), page: z.int().positive().optional() }).optional(),
  minutes: z.number().positive().optional(),
});
const material = z.strictObject({
  // Relative to a material folder, like a step file.
  path: z
    .string()
    .min(1)
    .refine((value) => !isAbsolute(value) && !/^[A-Za-z]:[\\/]/.test(value), 'Absolute path'),
  page: z.int().positive().optional(),
  label: z.string().min(1).optional(),
});
const day = z.strictObject({
  id,
  subject: id,
  phase: id.optional(),
  title: z.string().min(1),
  threads: z.array(id),
  recall: z.array(id),
  kind: z.enum(['study', 'mock', 'review']),
  minutes: z.number().positive().optional(),
  materials: z.array(material).optional(),
  blocks: z.array(z.strictObject({ id, title: z.string().min(1), steps: z.array(step) })),
  check: z.string(),
});

export const planShape = z.strictObject({
  schema: z.literal('hub.study-plan/1'),
  id,
  title: z.string().min(1),
  version: z.int().positive(),
  subjects: z.array(
    z.strictObject({
      id,
      name: z.string().min(1),
      exam: z.strictObject({ label: z.string(), required: z.boolean() }).optional(),
    }),
  ),
  threads: z.array(z.strictObject({ id, subject: id, title: z.string().min(1) })),
  phases: z.array(
    z.strictObject({
      id,
      title: z.string().min(1),
      mix: z.record(id, z.number().min(0).max(100)).optional(),
      note: z.string().optional(),
    }),
  ),
  method: z.array(z.string()),
  days: z.array(day),
});

export const planSchema = planShape.superRefine((plan, ctx) => {
  const subjects = new Set(plan.subjects.map((item) => item.id));
  const threads = new Set(plan.threads.map((item) => item.id));
  const phases = new Set(plan.phases.map((item) => item.id));
  const days = new Set(plan.days.map((item) => item.id));
  const seen = new Map<string, Set<string>>();
  function unique(kind: string, value: string, path: (string | number)[]) {
    const ids = seen.get(kind) ?? new Set<string>();
    if (ids.has(value)) ctx.addIssue({ code: 'custom', path, message: 'Duplicate id' });
    ids.add(value);
    seen.set(kind, ids);
  }
  function reference(valid: boolean, path: (string | number)[], message: string) {
    if (!valid) ctx.addIssue({ code: 'custom', path, message });
  }
  plan.subjects.forEach((item, i) => unique('subject', item.id, ['subjects', i, 'id']));
  plan.threads.forEach((item, i) => {
    unique('thread', item.id, ['threads', i, 'id']);
    reference(subjects.has(item.subject), ['threads', i, 'subject'], 'Unknown subject');
  });
  plan.phases.forEach((item, i) => {
    unique('phase', item.id, ['phases', i, 'id']);
    for (const subject of Object.keys(item.mix ?? {}))
      reference(subjects.has(subject), ['phases', i, 'mix', subject], 'Unknown subject');
  });
  plan.days.forEach((item, i) => {
    unique('day', item.id, ['days', i, 'id']);
    reference(subjects.has(item.subject), ['days', i, 'subject'], 'Unknown subject');
    reference(
      phases.size ? item.phase !== undefined && phases.has(item.phase) : item.phase === undefined,
      ['days', i, 'phase'],
      'Invalid phase',
    );
    item.threads.forEach((value, j) => reference(threads.has(value), ['days', i, 'threads', j], 'Unknown thread'));
    item.recall.forEach((value, j) => reference(days.has(value), ['days', i, 'recall', j], 'Unknown day'));
    item.blocks.forEach((block, j) => {
      unique('block', block.id, ['days', i, 'blocks', j, 'id']);
      block.steps.forEach((entry, k) => unique('step', entry.id, ['days', i, 'blocks', j, 'steps', k, 'id']));
    });
  });
});

export type StudyPlan = z.infer<typeof planSchema>;
