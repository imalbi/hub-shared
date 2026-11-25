import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractSalary, extractSalaryMatch } from './salary.ts';

void test('extractSalary parses explicit RAL with k ranges', () => {
  assert.equal(extractSalary('Offerta di lavoro con RAL 28-30k a Torino'), '28k - 30k €');
  assert.equal(extractSalary('RAL: 26k - 29k € indeterminato'), '26k - 29k €');
  assert.equal(extractSalary('Retribuzione annua lorda: 25.000 - 30.000 €'), '25.000 - 30.000 €');
  assert.equal(
    extractSalary('La retribuzione annua lorda sarà compresa tra Euro 23.258 ed Euro 28.816'),
    '23.258 - 28.816 €',
  );
  assert.equal(extractSalary('Collegno, indeterminato, 22,5-51k'), '22.5k - 51k €');
  assert.equal(extractSalary('Stipendio proposto: 35.000 €'), '35.000 €');
  assert.equal(extractSalary('RAL indicativa: 40k'), '40k €');
  assert.equal(
    extractSalary(
      'La retribuzione annua lorda (RAL) iniziale sarà compresa tra 25.500 € e 38.500 € in funzione dell’esperienza',
    ),
    '25.500 - 38.500 €',
  );
  assert.equal(extractSalary("RAL in base all'esperienza del candidato tra €24.000 e €30.000"), '24.000 - 30.000 €');
  assert.equal(extractSalary("RAL tra i 35k e i 45k, in base all'esperienza."), '35k - 45k €');
  assert.equal(
    extractSalary('RAL di partenza per figure junior: da 23.300€ a 26.000€ in funzione del titolo'),
    '23.300 - 26.000 €',
  );
  assert.equal(
    extractSalary('La retribuzione annua lorda per questo ruolo è compresa tra 32.000 EUR e 40.000 EUR.'),
    '32.000 - 40.000 €',
  );
  assert.equal(
    extractSalary("il ruolo prevede una retribuzione a partire da 24.000,00 €, che l'azienda potrà proporre"),
    '24.000 €',
  );
});

void test('extractSalary parses English keywords and EUR prefix', () => {
  assert.equal(extractSalary('Pay Range: EUR 27.550 - 30.000 Annual Salary'), '27.550 - 30.000 €');
  assert.equal(extractSalary('Salary: 35.000 - 45.000 EUR'), '35.000 - 45.000 €');
  assert.equal(extractSalary('Compensation: EUR 50k - 60k'), '50k - 60k €');
  assert.equal(extractSalary('Salary Band € 30.000 - 35.000'), '30.000 - 35.000 €');
  assert.equal(
    extractSalary(
      'Your starting gross annual salary (RAL) will range from €25,500 to €38,500, depending on your experience',
    ),
    '25.500 - 38.500 €',
  );
  assert.equal(
    extractSalary(
      'Salary starts from of €30,000 at entry level rising to €90,000 for those with significant relevant experience.',
    ),
    '30.000 - 90.000 €',
  );
  assert.equal(
    extractSalary('Minimum Base Salary: 28,000.00 EUR\nMaximum Base Salary: 36,000.00 EUR'),
    '28.000 - 36.000 €',
  );
});

void test('extractSalary parses CCNL level ranges and picks lowest entry level', () => {
  const accenture = `Per la presente posizione, è prevista l'applicazione del CCNL Metalmeccanico, con uno tra i seguenti livelli di inquadramento e corrispondente fascia di retribuzione annua lorda:
B2 33.058,74€ e 50.500€
B3 36.906,87 € e 65,800€`;
  assert.equal(extractSalary(accenture), '33.058 - 50.500 €');

  const seniority = `The final salary offer will be aligned within the following reference ranges:
Junior: €28,000 – €34,000 Gross Annual Salary
Middle: €34,000 – €42,000 Gross Annual Salary
Senior: €42,000 – €50,000 Gross Annual Salary`;
  assert.equal(extractSalary(seniority), '28.000 - 34.000 €');
});

void test('extractSalary parses amount before keyword (e.g. Jet HR)', () => {
  assert.equal(extractSalary('€45.000 – €65.000 di RAL.'), '45.000 - 65.000 €');
  assert.equal(extractSalary('45.000 - 65.000 € di retribuzione'), '45.000 - 65.000 €');
});

void test('extractSalary parses plus expressions (e.g. 25k+)', () => {
  assert.equal(extractSalary('RAL: 25k+'), '25k+ €');
  assert.equal(extractSalary('Offerta con 25k + indeterminato'), '25k+ €');
  assert.equal(extractSalary('Retribuzione annua da 28k+'), '28k+ €');
});

void test('extractSalary parses standalone ranges with currency markers', () => {
  assert.equal(extractSalary("Compenso compreso tra 28.000 € - 35.000 € all'anno"), '28.000 - 35.000 €');
  assert.equal(extractSalary("Range 30k - 35k € all'anno"), '30k - 35k €');
  assert.equal(extractSalary('Retribuzione 28.000 € / anno'), '28.000 €');
});

void test('extractSalary parses monthly salary mentions and decimal ranges', () => {
  assert.equal(extractSalary('Retribuzione: €1.600,00 - €2.500,00 al mese'), '1.600 - 2.500 €/m');
  assert.equal(extractSalary('Retribuzione: €743,81 - €2.519,88 al mese'), '744 - 2.520 €/m');
  assert.equal(extractSalary('Stipendio mensile: 1.800 € / mese'), '1.800 €/m');
  assert.equal(extractSalary('Compenso di circa 1500 € al mese'), '1.500 €/m');
});

void test('extractSalary ignores unrelated numbers or small amounts', () => {
  assert.equal(extractSalary('Buoni pasto da 8 € al giorno e 40 ore settimanali'), null);
  assert.equal(extractSalary('Fondata nel 2024 con oltre 50.000 utenti attivi'), null);
  assert.equal(extractSalary(null), null);
  assert.equal(extractSalary(''), null);
});

void test('a seniority word before two bare small numbers is not a salary band', () => {
  assert.equal(extractSalary('Cerchiamo un profilo Junior 20 e 25 anni di età'), null);
  assert.equal(extractSalary('Junior: €28,000 – €34,000, Senior: €40,000 – €55,000'), '28.000 - 34.000 €');
});

void test('extractSalary parses starting at, up to, fino a, max, and 5-digit unseparated amounts', () => {
  assert.deepEqual(extractSalaryMatch('Gross annual salary (RAL): Starting at €42,000 - based on experience'), {
    formatted: '42.000 €',
    rawTokens: ['€42,000'],
  });
  assert.deepEqual(extractSalaryMatch('Retribuzione: € 35000 - € 45000 Annuale'), {
    formatted: '35.000 - 45.000 €',
    rawTokens: ['€ 35000', '€ 45000'],
  });
  assert.equal(extractSalary('RAL: up to 50.000 €'), '50.000 €');
  assert.equal(extractSalary('RAL: fino a 27.000 €'), '27.000 €');
  assert.equal(extractSalary('RAL (da valutare in fase di colloquio): fino a 38k'), '38k €');
  assert.equal(extractSalary('salary range starts from €60,000 + bonus'), '60.000 €');
  assert.equal(extractSalary('RAL: (€40.000 - €50.000)'), '40.000 - 50.000 €');
  assert.equal(extractSalary('Retribuzione: a partire da €20.000'), '20.000 €');
  assert.equal(extractSalary('Ral: 20000€ - 25000€'), '20.000 - 25.000 €');
  assert.equal(extractSalary('RAL proposta: max 25k'), '25k €');
  assert.equal(extractSalary('RAL (28.000-35.000): Il range retributivo è flessibile'), '28.000 - 35.000 €');
  assert.equal(extractSalary('Sede Torino CAP 10121 con 50000 utenti attivi'), null);
});
