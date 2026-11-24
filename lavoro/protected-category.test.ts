import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isProtectedCategory } from './protected-category.ts';

void test('isProtectedCategory detects positions reserved in title', () => {
  assert.equal(isProtectedCategory('Jr Angular Developer – Posizione riservata a categorie protette (L.68/99)'), true);
  assert.equal(isProtectedCategory('IT Consultant/software developer - Categorie Protette L. 68/99'), true);
  assert.equal(isProtectedCategory('Frontend Developer (Cat. Protette)'), true);
  assert.equal(isProtectedCategory('Java Developer L. 68/99'), true);
  assert.equal(isProtectedCategory('Software Engineer - iscritto al collocamento mirato'), true);
  assert.equal(isProtectedCategory('Senior Full-Stack Engineer (Rails, React)'), false);
});

void test('isProtectedCategory detects positions reserved in description', () => {
  assert.equal(
    isProtectedCategory(
      'IT Consultant',
      'Per ampliamento del nostro organico, ricerchiamo profili di IT CONSULTANT, appartenenti alle categorie protette legge 68/99.',
    ),
    true,
  );
  assert.equal(
    isProtectedCategory(
      'Frontend Dev',
      'Posizione riservata esclusivamente a candidati appartenenti alle categorie protette (art. 1 o 18 L. 68/99).',
    ),
    true,
  );
  assert.equal(
    isProtectedCategory(
      'Cloud Architect',
      'Costituisce requisito obbligatorio: appartenenza alle categorie protette L. 68/99.',
    ),
    true,
  );
  assert.equal(
    isProtectedCategory('Data Analyst', 'La ricerca è riservata a candidati appartenenti alle categorie protette.'),
    true,
  );
});

void test('isProtectedCategory ignores generic equal opportunity / diversity disclaimers', () => {
  const disclaimerReply =
    "Reply si impegna a promuovere la diversità e a creare un ambiente di lavoro inclusivo, valorizzando l'unicità delle persone indipendentemente da età, genere, orientamento sessuale, religione, nazionalità, disabilità o qualsiasi altra caratteristica tutelata dalla Legge Italiana (L.68/99).";
  assert.equal(isProtectedCategory('Junior Agentic Software Engineer', disclaimerReply), false);

  const disclaimerCapgemini =
    "L'offerta di lavoro si intende rivolta all'uno e all'altro sesso in ottemperanza al D.Lgs. 198/2006. Inoltre, prestiamo attenzione e sensibilità alle future risorse appartenenti alle categorie protette, ai sensi degli articoli 1 e 18 della legge 68 del ‘99.";
  assert.equal(isProtectedCategory('Electronic & Semiconductor Engineer', disclaimerCapgemini), false);

  assert.equal(isProtectedCategory('Web Developer', null), false);
  assert.equal(isProtectedCategory('Web Developer', ''), false);
});
