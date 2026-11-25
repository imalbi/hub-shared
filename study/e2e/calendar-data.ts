import type { APIRequestContext } from '../../../apps/e2e/tests/fixtures.ts';

const json = { 'content-type': 'application/json' };
// Study plans another spec of this process left active would add their days to the month: paused here, resumed in `clean`.
let paused: string[] = [];

async function activePlans(pc: APIRequestContext): Promise<string[]> {
  const plans: Array<{ id: string }> = (await (await pc.get('/trpc/study.active')).json()).result.data;
  return plans.map((plan) => plan.id);
}
export const setPlan = (pc: APIRequestContext, id: string, active: boolean) =>
  pc.post('/trpc/study.setPlan', { data: { id, active }, headers: json });

export async function seed(pc: APIRequestContext) {
  paused = await activePlans(pc);
  for (const id of paused) await setPlan(pc, id, false);
  const add = (title: string, day: string, start?: string, end?: string) =>
    pc.post('/trpc/calendar.add', { data: { title, day, start, end }, headers: json });
  await add('Dentista', '2026-11-15', '16:30');
  await add('Cena da Marco', '2026-11-21', '20:00', '22:30');
  await add('Visita', '2026-11-19', '09:00');
  await add('Pranzo', '2026-11-19', '12:30');
  await add('Riunione', '2026-11-19', '15:00');
  await add('Corso', '2026-11-19', '18:00');
  await pc.post('/trpc/notes.add', { data: { text: 'Riprendere step 55', forDay: '2026-11-16' }, headers: json });
}

/** Shifts of a generic person across the week of 16 November; the overnight one ends on the 18th. */
export async function seedShifts(pc: APIRequestContext) {
  const add = (day: string, person: string, start: string, end: string) =>
    pc.post('/trpc/calendar.add', {
      data: { title: 'Turno', kind: 'shift', person, day, start, end },
      headers: json,
    });
  await add('2026-11-16', 'Persona A', '06:00', '14:00');
  await add('2026-11-17', 'Persona B', '22:00', '06:00');
  await add('2026-11-19', 'Persona A', '14:00', '22:00');
  await add('2026-11-21', 'Persona A', '06:00', '14:00');
}

export async function clean(pc: APIRequestContext) {
  const range = { from: '2026-10-01', to: '2026-12-31' };
  const events: Array<{ id: string; seriesId: string | null }> = (
    await (await pc.get(`/trpc/calendar.range?input=${encodeURIComponent(JSON.stringify(range))}`)).json()
  ).result.data;
  for (const id of new Set(events.flatMap((event) => (event.seriesId ? [event.seriesId] : []))))
    await pc.post('/trpc/calendar.removeSeries', { data: { id }, headers: json });
  for (const { id } of events.filter((event) => !event.id.startsWith('series:')))
    await pc.post('/trpc/calendar.remove', { data: { id }, headers: json });
  const notes: Array<{ id: string }> = (await (await pc.get('/trpc/notes.open')).json()).result.data;
  for (const { id } of notes) await pc.post('/trpc/notes.remove', { data: { id }, headers: json });
  await pc.post('/trpc/layout.reset', { data: { zone: 'overview' }, headers: json });
  for (const id of await activePlans(pc)) await setPlan(pc, id, false);
  for (const id of paused) await setPlan(pc, id, true);
  paused = [];
}
