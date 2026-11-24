import assert from 'node:assert/strict';
import { test } from 'node:test';
import { profileSchema } from './config.ts';
import { inventedProfile } from './invented-profile.ts';
import { stableExclusion, stableReasons } from './stable.ts';

const stable = profileSchema.parse({
  ...inventedProfile(),
  stable: {
    companies: ['Intesa Sanpaolo', 'Crédit Agricole Italia', 'Iren'],
    sites: ['reteinformaticalavoro'],
    excludePhrases: ['turni notturni'],
  },
}).stable;
assert.ok(stable);

void test('the company matches whatever surrounds the listed name: legal form, "Gruppo", accents, case', () => {
  for (const company of [
    'Intesa Sanpaolo S.p.A.',
    'Gruppo Intesa Sanpaolo',
    'INTESA SANPAOLO',
    'Credit Agricole Italia',
  ])
    assert.deepEqual(stableReasons({ title: 'Addetto', company }, stable), ['company'], company);
  assert.deepEqual(stableReasons({ title: 'Addetto', company: 'Iren Energia S.p.A.' }, stable), ['company']);
});

void test('a listed name has to be whole words of the company', () => {
  assert.deepEqual(stableReasons({ title: 'Addetto', company: 'Ireneo Srl' }, stable), []);
  assert.deepEqual(stableReasons({ title: 'Addetto', company: 'Intesa' }, stable), []);
});

void test('an employer named only in the description does not make the posting Stabile', () => {
  const posting = { title: 'Consulente', company: 'Acme Consulting', description: 'Lavoriamo per clienti come Iren.' };
  assert.deepEqual(stableReasons(posting, stable), []);
});

void test('"tempo indeterminato" alone does not make an unknown company Stabile', () => {
  const company = 'Acme';
  assert.deepEqual(
    stableReasons({ title: 'Impiegato', company, description: 'Offriamo un contratto a tempo indeterminato.' }, stable),
    [],
  );
  assert.deepEqual(
    stableReasons({ title: 'Impiegato', company, description: 'Contratto a tempo determinato di 6 mesi' }, stable),
    [],
  );
});

void test('a source listed in stable.sites makes it Stabile; reasons come back together', () => {
  assert.deepEqual(stableReasons({ title: 'Tecnico', company: 'Acme', site: 'reteinformaticalavoro' }, stable), [
    'site',
  ]);
  assert.deepEqual(stableReasons({ title: 'Tecnico', company: 'Acme', site: 'indeed' }, stable), []);
  assert.deepEqual(
    stableReasons(
      { title: 'Tecnico', company: 'Iren', site: 'reteinformaticalavoro', description: 'tempo indeterminato' },
      stable,
    ),
    ['company', 'site'],
  );
});

void test('a degree requirement drops, a degree that is optional or preferred does not', () => {
  const dropped = [
    'Laurea obbligatoria.',
    'Titolo: laurea richiesta',
    'Laurea indispensabile per il ruolo',
    'Requisiti: laurea in economia',
    'È richiesta la laurea in ingegneria.',
    'Il possesso della laurea magistrale è necessario',
    'Titolo di studio: laurea triennale',
  ];
  for (const text of dropped) assert.equal(stableExclusion('Impiegato', text, []), 'laurea', text);
  const kept = [
    'Laurea o diploma',
    'Diploma o laurea',
    'Laurea preferibile',
    'Laurea gradita, non obbligatoria',
    'La laurea costituisce titolo preferenziale',
    'Requisiti: laurea o diploma di scuola superiore',
    'È richiesta la laurea o diploma tecnico',
    'Titolo di studio: diploma',
  ];
  for (const text of kept) assert.equal(stableExclusion('Impiegato', text, []), null, text);
});

void test('a study-level field that names a degree drops, one that allows a diploma does not (IRENfutura wording)', () => {
  const dropped = [
    'Titolo di studio richiesto: Laurea in Ingegneria',
    'Livello di studio: Laurea specialistica/magistrale',
    'Requisiti richiesti:\n•\tTitolo di studio: Laurea in Ingegneria',
    // The diploma in the next sentence is another requirement, not an alternative.
    'Titolo di studio: Laurea in Ingegneria. Patente B o diploma di guida sicura',
  ];
  for (const text of dropped) assert.equal(stableExclusion('Addetto', text, []), 'laurea', text);
  const kept = [
    'Titolo di studio richiesto: Diploma tecnico',
    'Livello di studio: Diploma di istruzione secondaria superiore',
    'Titolo di studio richiesto: Laurea o diploma',
    'Livello di studio: Laurea gradita',
    'Titolo di studio: Laurea triennale o diploma tecnico',
    'Titolo di studio richiesto: Laurea in Ingegneria o diploma di perito',
    'Requisiti: laurea in economia, preferibile',
  ];
  for (const text of kept) assert.equal(stableExclusion('Addetto', text, []), null, text);
});

void test('a health qualification drops, in the title or the text', () => {
  assert.equal(stableExclusion('Infermiere professionale', '', []), 'sanitario');
  assert.equal(stableExclusion('Medico competente', '', []), 'sanitario');
  assert.equal(stableExclusion('Operatore OSS', '', []), 'sanitario');
  assert.equal(stableExclusion('Impiegato', 'Richiesta iscrizione all’albo professionale', []), 'sanitario');
  assert.equal(stableExclusion('Impiegato', "Iscrizione all'albo degli infermieri", []), 'sanitario');
  assert.equal(stableExclusion('Addetto', 'Qualifica OSS necessaria', []), 'sanitario');
  assert.equal(stableExclusion('Addetto', 'Laurea in infermieristica', []), 'sanitario');
  assert.equal(stableExclusion('Tecnico informatico', 'Assistenza ai medici di base', []), null);
  assert.equal(stableExclusion('Addetto sportello', 'Si occupa di iscrizione ai corsi', []), null);
});

void test('a licence above B drops, B alone does not, and a lowercase "e" is not category E', () => {
  for (const text of [
    'Patente C',
    'patente CE richiesta',
    'Patente di guida categoria D',
    'Patente B e C',
    'CQC',
    'ADR',
  ])
    assert.equal(stableExclusion('Autista', text, []), 'patente', text);
  for (const text of ['Patente B', 'Patente B e automunito', 'patente e automunito', 'Patente B o superiore'])
    assert.equal(stableExclusion('Operatore', text, []), null, text);
});

void test('the configured phrases drop as "altro", after the code reasons', () => {
  assert.equal(stableExclusion('Operatore', 'Previsti turni notturni', ['turni notturni']), 'altro');
  assert.equal(stableExclusion('Operatore', 'Previsti turni notturni', []), null);
  assert.equal(stableExclusion('Operatore', 'Laurea obbligatoria, turni notturni', ['turni notturni']), 'laurea');
});
