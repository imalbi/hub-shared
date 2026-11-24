import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requiredYears } from './years.ts';

void test('a requirement is read in Italian and English', () => {
  assert.equal(requiredYears('Richiesti almeno 3 anni di esperienza con TypeScript.'), 3);
  assert.equal(requiredYears('At least 5+ years of experience with Node.'), 5);
  assert.equal(requiredYears('Minimo 2 anni di comprovata esperienza.'), 2);
  assert.equal(requiredYears('Requisiti minimi: 1–2 anni di esperienza nello sviluppo software.'), 1);
  assert.equal(requiredYears('1+ anni di esperienza nel ruolo.'), 1);
  assert.equal(
    requiredYears('5+ years of professional software engineering experience across backend and frontend.'),
    5,
  );
  assert.equal(requiredYears('Esperienza di almeno 3 anni in attività progettuali di sviluppo software.'), 3);
  assert.equal(requiredYears('con almeno 2/3 anni di esperienza.'), 2);
  assert.equal(requiredYears('Esperienza professionale di almeno 2 anni nello sviluppo software.'), 2);
});

void test('a range yields its smallest number', () => {
  assert.equal(requiredYears('Richiesti almeno 3-5 anni di esperienza.'), 3);
  assert.equal(requiredYears('At least 2 to 4 years of experience.'), null, 'only a dash or plus makes a range');
});

void test('a sentence about the company is not a requirement', () => {
  assert.equal(requiredYears('Azienda leader nel settore, con almeno 15 anni di esperienza.'), null);
  assert.equal(
    requiredYears('Siamo nati nel 2001 e vantiamo oltre 15 anni di esperienza. Richiesti almeno 2 anni di esperienza.'),
    2,
  );
  assert.equal(requiredYears('Founded in 2005, we have at least 12 years of experience.'), null);
});

void test('the profile can add words that mark a company sentence', () => {
  const text = 'Il gruppo Esempio opera dal 1990 con almeno 10 anni di esperienza.';
  assert.equal(requiredYears(text), 10);
  assert.equal(requiredYears(text, ['il gruppo']), null);
});

void test('numbers outside 1 to 19 and phrases without a qualifier are ignored', () => {
  assert.equal(requiredYears('Almeno 25 anni di esperienza.'), null);
  assert.equal(requiredYears('Almeno 0 anni di esperienza.'), null);
  assert.equal(requiredYears('Oltre 4 anni di esperienza.'), null);
  assert.equal(requiredYears(''), null);
});

void test('a requirement sentence that also says "oltre a" still counts', () => {
  assert.equal(requiredYears('Richiesti almeno 3 anni di esperienza, oltre a conoscenza di React.'), 3);
});
