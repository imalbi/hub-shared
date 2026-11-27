import assert from 'node:assert/strict';
import { test } from 'node:test';
import { copy } from './copy.ts';
import { highlightHtmlText } from './format.ts';
import type { JobRow } from './server.ts';
import { detailSummary, markTerms } from './summary.ts';

const text = copy.detail.summary;

const base: JobRow = {
  key: 'acme|dev',
  comparisonKey: 'acme|dev',
  title: 'Web Developer',
  company: 'Acme Corp',
  location: 'Exampleville',
  site: 'indeed',
  url: 'https://indeed.example/jobs/1',
  applyUrl: null,
  score: 10,
  total: 10,
  reasons: [],
  categories: [],
  description: 'Building web apps',
  descriptionHtml: null,
  workMode: null,
  isRemote: false,
  detailsMissing: false,
  hasCv: false,
  postedAt: 1000,
  firstSeen: 1000,
  importedAt: null,
  blacklistRule: null,
  archivedAt: null,
  deletedAt: null,
  application: null,
  companyApplications: [],
  opinion: null,
};

const job = (change: Partial<JobRow>): JobRow => ({ ...base, ...change });
const row = (rows: ReturnType<typeof detailSummary>, id: 'exclude' | 'consider' | 'favor') =>
  rows.find((r) => r.id === id)?.items ?? [];

void test('a negative reason, a years penalty and a required degree rule the posting out', () => {
  const rows = detailSummary(
    job({
      reasons: ['senior:-4', '5+ anni:-6'],
      description: 'Requisito: laurea in ingegneria informatica.',
    }),
  );
  assert.deepEqual(row(rows, 'exclude'), ['senior', text.years_over(5), text.laurea]);
  assert.deepEqual(row(rows, 'favor'), []);
});

void test('a positive skill, the salary and a permanent contract speak for the posting', () => {
  const rows = detailSummary(
    job({
      reasons: ['addetto:+3', 'torino:+3 (sede)', 'react:+2 (descr.)', 'stabile:indeterminato'],
      description: 'Retribuzione: 1.800 - 2.000 €/mese',
    }),
  );
  assert.deepEqual(row(rows, 'favor'), [
    'addetto',
    'torino',
    'react',
    text.salary('1.800 - 2.000 €/m'),
    text.permanent,
  ]);
});

void test('years under the limit, on-site work and a protected category are left to judge', () => {
  const rows = detailSummary(
    job({ reasons: ['3 anni'], workMode: 'onsite', title: 'Impiegato categorie protette L. 68/99' }),
  );
  assert.deepEqual(row(rows, 'consider'), [text.years_asked(3), text.on_site, text.protected]);
  // The protected category is judged, not repeated as a negative reason.
  assert.deepEqual(
    row(detailSummary(job({ reasons: ['categorie protette:-100'], title: 'Impiegato categorie protette' })), 'exclude'),
    [],
  );
});

void test('bookkeeping reasons appear nowhere and a posting with nothing to say has no rows', () => {
  const rows = detailSummary(
    job({ reasons: ['stabile:azienda', 'stabile:fonte', 'stabile:sotto soglia', 'onsite:+2 (modalità)'] }),
  );
  assert.deepEqual(rows, []);
  assert.deepEqual(detailSummary(job({})), []);
});

void test('a degree or a licence in the text excludes any posting, Stabile or not', () => {
  assert.deepEqual(row(detailSummary(job({ description: 'Richiesta patente C e CQC.' })), 'exclude'), [text.patente]);
  assert.deepEqual(row(detailSummary(job({ title: 'Infermiere professionale', description: 'Turni.' })), 'exclude'), [
    text.sanitario,
  ]);
});

void test('marks sit on the words the summary names, by kind', () => {
  const terms = markTerms(
    job({
      reasons: ['senior:-4', '5+ anni:-6', 'react:+2 (descr.)', 'stabile:indeterminato'],
      categories: ['Frontend'],
      description:
        'Laurea richiesta. Richiesti 5 anni di esperienza. Retribuzione: 1.800 - 2.000 €/mese. Contratto a tempo indeterminato.',
    }),
  );
  const of = (mark: string) => terms.filter((t) => t.mark === mark).map((t) => t.text);
  assert.deepEqual(of('exclude'), ['senior', '5 anni', 'laurea']);
  assert.deepEqual(of('salary'), ['1.800', '2.000']);
  assert.deepEqual(of('contract'), ['tempo indeterminato']);
  assert.deepEqual(of('skill'), ['react', 'Frontend']);
  // The section titles that used to be marked are not terms any more.
  assert.ok(!terms.some((t) => /requisiti|chi cerchiamo|cosa offriamo/i.test(t.text)));
});

void test('permanent contract phrase in text is shown and marked even without stabile:indeterminato reason', () => {
  const posting = job({
    reasons: ['tempo indeterminato:+2 (descr.)'],
    description: 'Assunzione con contratto a tempo indeterminato.',
  });
  assert.deepEqual(row(detailSummary(posting), 'favor'), [text.permanent]);
  assert.deepEqual(markTerms(posting), [{ text: 'tempo indeterminato', mark: 'contract' }]);
});

void test('markTerms preserves exact raw salary token for highlighting formatted amounts', () => {
  const html = '<p>Gross annual salary (RAL): Starting at €42,000 - based on experience.</p>';
  const posting = job({ description: null, descriptionHtml: html });
  const terms = markTerms(posting);
  assert.deepEqual(terms, [{ text: '€42,000', mark: 'salary' }]);
  assert.equal(
    highlightHtmlText(html, terms),
    '<p>Gross annual salary (RAL): Starting at <span data-mark="salary">€42,000</span> - based on experience.</p>',
  );
});
