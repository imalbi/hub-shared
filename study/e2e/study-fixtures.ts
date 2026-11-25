import { readFile } from 'node:fs/promises';

const longPath =
  'Botanica/01 Teoria e Slide/Slide Ufficiali Prof/Capitolo 03 - La struttura delle foglie e dei tessuti.pdf';
const exercisePath = 'Botanica/03_Esercizi_e_Calcolo/Esercitazioni_Ufficiali_Prof/2_Anatomia_vegetale_DV.pdf';

/** The shape of a real plan that read badly: three blocks, no phases, long nested paths with spaces, steps with and without files. */
export const legibleDay = {
  id: 'A01',
  subject: 'a',
  title: 'La foglia',
  threads: ['plants'],
  recall: [],
  kind: 'study',
  minutes: 90,
  materials: [{ path: 'dispensa.pdf', page: 5, label: 'Dispensa' }, { path: 'Botanica/Errata Verificati.pdf' }],
  blocks: [
    {
      id: 'A01.m',
      title: 'Mattino',
      steps: [
        {
          id: 'A01.m.1',
          text: 'Leggi il capitolo sui tessuti e annota i termini nuovi.',
          file: { path: longPath, page: 34 },
          minutes: 40,
        },
        { id: 'A01.m.2', text: 'Rileggi gli esempi come riscontro.', file: { path: exercisePath, page: 18 } },
      ],
    },
    {
      id: 'A01.p',
      title: 'Pomeriggio',
      steps: [
        { id: 'A01.p.1', text: 'Svolgi gli esercizi da 1 a 11.', file: { path: 'dispensa.pdf', page: 3 }, minutes: 30 },
        { id: 'A01.p.2', text: 'Confronta con le soluzioni.', file: { path: exercisePath } },
        { id: 'A01.p.3', text: 'Rivedi gli errori della giornata.' },
      ],
    },
    { id: 'A01.c', title: 'Chiusura', steps: [{ id: 'A01.c.1', text: 'Scrivi tre righe di sintesi.', minutes: 10 }] },
  ],
  check: 'Spiega a voce la struttura di una foglia senza appunti.',
};

/** The example plan with one subject, no phases and the day above as its first day. */
export async function legiblePlan() {
  const plan = JSON.parse(await readFile(new URL('../fixtures/example.json', import.meta.url), 'utf8'));
  plan.subjects = [plan.subjects[0]];
  plan.threads = [plan.threads[0]];
  plan.phases = [];
  plan.days = [
    legibleDay,
    ...plan.days.slice(1).map((day: object) => ({ ...day, subject: 'a', phase: undefined, threads: ['plants'] })),
  ];
  return plan;
}
