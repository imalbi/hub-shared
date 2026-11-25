import { watch, type FSWatcher } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from '../../apps/server/src/core/module-db.ts';
import { defineModule, TRPCError, z } from '../../apps/server/src/core/module.ts';
import { createLiveHub } from '../../apps/server/src/core/live.ts';
import { loopbackProcedure, protectedProcedure, router } from '../../apps/server/src/core/trpc.ts';
import { errorInput, readErrors, readReview, serializeError } from './errors.ts';
import { listInbox, readPlan } from './inbox.ts';
import { listMaterials, readMaterial } from './library.ts';
import { planShape } from './plan.ts';
import { activeHeaders, GLOBAL, readDays, readDaysById, readIndex, searchDays, subjectKey } from './read.ts';
import { plans, preferences, progress } from './schema.ts';
import { savePlan } from './store.ts';
import { createStateWriter } from './state.ts';

export const studyModule = defineModule({
  name: 'study',
  zones: ['studio'],
  migrations: fileURLToPath(new URL('./drizzle', import.meta.url)),
  config: z
    .object({
      plansDir: z.string().default('').meta({
        manual: true,
        title: 'Cartella piani',
        description: 'Cartella dei piani; lascia vuoto per disattivare la ricerca.',
      }),
      materialDirs: z
        .array(z.string())
        .default([])
        .meta({ manual: true, title: 'Cartelle materiali', description: 'Cartelle dei materiali di studio.' }),
    })
    .default({ plansDir: '', materialDirs: [] }),
  create({ db, config, log, focusHistory }) {
    const inboxDir = join(config.plansDir, 'in-arrivo');
    const archiveDir = join(config.plansDir, 'archivio');
    let watcher: FSWatcher | undefined;
    let closed = false;
    let activating = false;
    const ready = config.plansDir
      ? mkdir(inboxDir, { recursive: true })
          .then(() => {
            if (!closed) watcher = watch(inboxDir, { recursive: true }, () => void live.notify());
            watcher?.on('error', () => log.warn('Study inbox watcher failed'));
          })
          .catch(() => log.warn('Study inbox is unavailable'))
      : Promise.resolve();
    async function inbox() {
      if (!config.plansDir) return [];
      await ready;
      try {
        return await listInbox(inboxDir);
      } catch {
        return [];
      }
    }
    const live = createLiveHub(inbox, null);
    const state = createStateWriter(
      db,
      config.plansDir,
      (error) => log.warn({ err: error }, 'Study state export failed'),
      focusHistory,
    );
    const unsubscribeFocus = focusHistory.subscribe((tag) => {
      const [prefix, planId] = tag.split('/');
      if (prefix === 'study' && planId) state.schedule(planId);
    });
    function save(planId: string, kind: string, id: string, value: string) {
      db.insert(progress)
        .values({ planId, kind, id, value })
        .onConflictDoUpdate({
          target: [progress.planId, progress.kind, progress.id],
          set: { value },
        })
        .run();
    }
    function rememberCurrent() {
      const current = readIndex(db)?.current;
      if (current) save(GLOBAL, 'current', 'current', current);
    }
    function exportAll() {
      for (const header of activeHeaders(db)) state.schedule(header.id);
    }
    return {
      router: router({
        focusMinutes: protectedProcedure.query(() => focusHistory.minutesByTag('study/')),
        library: protectedProcedure.query(() => listMaterials(config.materialDirs)),
        openMaterial: protectedProcedure
          .meta({ label: 'Apri materiale', description: 'Open a PDF from the configured study material folders' })
          .input(z.object({ path: z.string().min(1), folder: z.int().min(0).optional() }))
          .mutation(async ({ input, ctx }) => {
            const file = await readMaterial(config.materialDirs, input.path, input.folder);
            return ctx.files.put(file.bytes, { name: file.name, mime: 'application/pdf' });
          }),
        inbox: protectedProcedure.query(inbox),
        onInbox: protectedProcedure.subscription(({ signal }) => live.subscribe(signal)),
        active: protectedProcedure.query(() => activeHeaders(db)),
        paused: protectedProcedure.query(() =>
          db
            .select()
            .from(plans)
            .where(eq(plans.active, false))
            .orderBy(plans.id)
            .all()
            .map((row) => {
              const header = planShape.omit({ days: true }).parse(JSON.parse(row.header));
              return { id: header.id, title: header.title, version: header.version };
            }),
        ),
        index: protectedProcedure.query(() => readIndex(db)),
        progress: protectedProcedure.query(() =>
          activeHeaders(db).flatMap((header) => db.select().from(progress).where(eq(progress.planId, header.id)).all()),
        ),
        setCurrent: protectedProcedure
          .meta({ label: 'Giorno corrente', description: 'Choose the current study day' })
          .input(z.object({ key: z.string() }))
          .mutation(({ input }) => {
            if (!readIndex(db)?.days.some((day) => day.key === input.key && !day.done))
              throw new TRPCError({ code: 'BAD_REQUEST' });
            save(GLOBAL, 'current', 'current', input.key);
            exportAll();
          }),
        openToday: protectedProcedure
          .meta({ label: 'Apri Oggi', description: 'Advance a completed current day' })
          .mutation(() => {
            const index = readIndex(db);
            const current = index?.days.find((day) => day.key === index.current);
            const next = current?.done ? index?.days.find((day) => !day.done) : current;
            if (next) save(GLOBAL, 'current', 'current', next.key);
            exportAll();
          }),
        setStep: protectedProcedure
          .meta({ label: 'Passo di studio', description: 'Mark a study step complete or open' })
          .input(z.object({ key: z.string(), id: z.string(), done: z.boolean() }))
          .mutation(({ input }) => {
            const body = readDaysById(db, [input.key])[0];
            if (!body || !body.blocks.some((block) => block.steps.some((step) => step.id === input.id)))
              throw new TRPCError({ code: 'BAD_REQUEST' });
            db.transaction(() => {
              rememberCurrent();
              save(body.planId, 'step', input.id, input.done ? 'done' : 'open');
              const records = db.select().from(progress).where(eq(progress.planId, body.planId)).all();
              const steps = body.blocks.flatMap((block) => block.steps);
              const done =
                steps.length > 0 &&
                steps.every((step) =>
                  records.some((item) => item.kind === 'step' && item.id === step.id && item.value === 'done'),
                );
              const wasDone = records.some(
                (item) => item.kind === 'day' && item.id === body.id && item.value === 'done',
              );
              if (done && !wasDone) save(body.planId, 'doneAt', body.id, new Date().toISOString());
              if (!done && wasDone) save(body.planId, 'doneAt', body.id, '');
              save(body.planId, 'day', body.id, done ? 'done' : 'open');
            });
            state.schedule(body.planId);
          }),
        setNote: protectedProcedure
          .meta({ label: 'Nota di studio', description: 'Save notes for a study day' })
          .input(z.object({ key: z.string(), text: z.string().max(20000) }))
          .mutation(({ input }) => {
            const body = readDaysById(db, [input.key])[0];
            if (!body) throw new TRPCError({ code: 'BAD_REQUEST' });
            save(body.planId, 'note', body.id, input.text);
            state.schedule(body.planId);
          }),
        setAutonomy: protectedProcedure
          .meta({ label: 'Autonomia', description: 'Set autonomy for a study thread' })
          .input(z.object({ plan: z.string(), id: z.string(), value: z.enum(['unset', 'red', 'yellow', 'green']) }))
          .mutation(({ input }) => {
            const header = activeHeaders(db).find((item) => item.id === input.plan);
            if (!header?.threads.some((thread) => thread.id === input.id)) throw new TRPCError({ code: 'BAD_REQUEST' });
            save(input.plan, 'autonomy', input.id, input.value);
            state.schedule(input.plan);
          }),
        errors: protectedProcedure.query(() => readErrors(db)),
        review: protectedProcedure.query(() => readReview(db)),
        setError: protectedProcedure
          .meta({ label: 'Errore di studio', description: 'Save or edit an entry of the study error log' })
          .input(errorInput)
          .mutation(({ input }) => {
            const [body] = readDaysById(db, [input.key]);
            if (!body || (input.retry !== null && !readDaysById(db, [input.retry]).length))
              throw new TRPCError({ code: 'BAD_REQUEST' });
            if (input.id && !readErrors(db, [body.planId]).some((entry) => entry.id === input.id))
              throw new TRPCError({ code: 'BAD_REQUEST' });
            const id = input.id ?? randomUUID();
            save(body.planId, 'error', id, serializeError(input, body.id));
            state.schedule(body.planId);
            return { id };
          }),
        days: protectedProcedure
          .input(z.object({ offset: z.int().min(0), limit: z.int().min(1).max(100) }))
          .query(({ input }) => readDays(db, input.offset, input.limit)),
        // The palette's records (step 64): PC only, like every search that returns titles.
        searchRecords: loopbackProcedure
          .input(z.object({ query: z.string().trim().min(1).max(100) }))
          // The headers ride along so one request is enough to name each day's subject.
          .query(({ input }) => ({ ...searchDays(db, input.query), headers: activeHeaders(db) })),
        daysById: protectedProcedure
          .input(z.object({ keys: z.array(z.string()).max(100) }))
          .query(({ input }) => readDaysById(db, input.keys)),
        setPlan: protectedProcedure
          .meta({ label: 'Stato piano', description: 'Pause or resume a study plan; paused plans keep their progress' })
          .input(z.object({ id: z.string(), active: z.boolean() }))
          .mutation(({ input }) => {
            const row = db.select().from(plans).where(eq(plans.id, input.id)).get();
            if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
            rememberCurrent();
            db.update(plans).set({ active: input.active }).where(eq(plans.id, input.id)).run();
            rememberCurrent();
            state.schedule(input.id);
            exportAll();
          }),
        setSubject: protectedProcedure
          .meta({ label: 'Stato materia', description: 'Pause or resume a study subject' })
          .input(z.object({ plan: z.string(), id: z.string(), state: z.enum(['active', 'paused', 'passed']) }))
          .mutation(({ input }) => {
            const header = activeHeaders(db).find((item) => item.id === input.plan);
            if (!header?.subjects.some((subject) => subject.id === input.id))
              throw new TRPCError({ code: 'BAD_REQUEST' });
            rememberCurrent();
            db.insert(progress)
              .values({ planId: header.id, kind: 'subject', id: input.id, value: input.state })
              .onConflictDoUpdate({
                target: [progress.planId, progress.kind, progress.id],
                set: { value: input.state },
              })
              .run();
            rememberCurrent();
            exportAll();
          }),
        setMix: protectedProcedure
          .meta({
            label: 'Mix di studio',
            description: 'Set weekly hours and the share of each subject of the active study plans',
          })
          .input(
            z.object({ hours: z.number().positive().max(168), mix: z.record(z.string(), z.number().min(0).max(100)) }),
          )
          .mutation(({ input }) => {
            const headers = activeHeaders(db);
            if (!headers.length) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
            const keys = new Set(
              headers.flatMap((header) => header.subjects.map((subject) => subjectKey(header.id, subject.id))),
            );
            const entries = Object.entries(input.mix);
            const states = readIndex(db)?.states ?? {};
            if (
              entries.length !== keys.size ||
              entries.some(([key]) => !keys.has(key)) ||
              entries.some(([key, share]) => (states[key] === 'paused' || states[key] === 'passed') && share !== 0) ||
              Math.abs(entries.reduce((sum, [, share]) => sum + share, 0) - 100) > 0.000001
            )
              throw new TRPCError({ code: 'BAD_REQUEST' });
            const weeklyHours = Math.round(input.hours * 60);
            rememberCurrent();
            db.insert(preferences)
              .values({ planId: GLOBAL, weeklyHours, mix: JSON.stringify(input.mix) })
              .onConflictDoUpdate({ target: preferences.planId, set: { weeklyHours, mix: JSON.stringify(input.mix) } })
              .run();
            exportAll();
          }),
        activate: protectedProcedure
          .meta({ label: 'Attiva piano', description: 'Activate a valid study plan from the inbox' })
          .input(
            z.object({
              name: z
                .string()
                .min(1)
                .regex(/^[^/\\]+$/)
                .refine((name) => name !== '.' && name !== '..'),
            }),
          )
          .mutation(async ({ input }) => {
            if (!config.plansDir) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
            if (activating) throw new TRPCError({ code: 'CONFLICT' });
            activating = true;
            try {
              await ready;
              const source = join(inboxDir, input.name);
              let plan;
              try {
                plan = await readPlan(source);
              } catch {
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'Invalid plan' });
              }
              await mkdir(archiveDir, { recursive: true });
              let target = join(archiveDir, input.name);
              try {
                await lstat(target);
                target = join(archiveDir, `${randomUUID()}-${input.name}`);
              } catch (error) {
                if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
              }
              await rename(source, target);
              try {
                savePlan(db, plan);
              } catch (error) {
                await rename(target, source);
                throw error;
              }
              void live.notify();
              exportAll();
            } finally {
              activating = false;
            }
          }),
      }),
      close: async () => {
        closed = true;
        await ready;
        watcher?.close();
        unsubscribeFocus();
        await state.close();
      },
    };
  },
});

export default studyModule;
