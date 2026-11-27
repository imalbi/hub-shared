import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { JobRow } from './server.ts';
import {
  highlightTerms,
  matchesAdvancedSearch,
  matchesFreeSearch,
  parseFreeSearch,
  type AdvancedSearch,
} from './search.ts';

const sampleJob: JobRow = {
  key: 'acme|frontend',
  comparisonKey: 'acme|frontend',
  title: 'Senior Frontend Developer',
  company: 'Società Acme Italia',
  location: 'Torino, Italia',
  site: 'indeed',
  url: 'https://example.com/1',
  applyUrl: null,
  score: 10,
  total: 10,
  reasons: [],
  categories: ['Frontend'],
  description: 'Cerchiamo uno sviluppatore esperto in React e TypeScript per applicazioni cloud.',
  descriptionHtml: null,
  workMode: 'remote',
  isRemote: true,
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

void test('parseFreeSearch extracts words, quoted phrases and negations', () => {
  const parsed = parseFreeSearch('react frontend "senior developer" -angular -"vue js"');
  assert.deepEqual(parsed.positiveWords, ['react', 'frontend']);
  assert.deepEqual(parsed.positivePhrases, ['senior developer']);
  assert.deepEqual(parsed.negativeWords, ['angular']);
  assert.deepEqual(parsed.negativePhrases, ['vue js']);
});

void test('matchesFreeSearch requires all positive words and phrases to appear', () => {
  const q1 = parseFreeSearch('frontend react');
  assert.equal(matchesFreeSearch(sampleJob, q1), true);

  const q2 = parseFreeSearch('frontend python');
  assert.equal(matchesFreeSearch(sampleJob, q2), false);

  const q3 = parseFreeSearch('"senior frontend" react');
  assert.equal(matchesFreeSearch(sampleJob, q3), true);

  const q4 = parseFreeSearch('"junior frontend"');
  assert.equal(matchesFreeSearch(sampleJob, q4), false);
});

void test('matchesFreeSearch excludes any matching negative word or phrase', () => {
  const q1 = parseFreeSearch('frontend -angular');
  assert.equal(matchesFreeSearch(sampleJob, q1), true);

  const q2 = parseFreeSearch('frontend -typescript');
  assert.equal(matchesFreeSearch(sampleJob, q2), false);

  const q3 = parseFreeSearch('frontend -"applicazioni cloud"');
  assert.equal(matchesFreeSearch(sampleJob, q3), false);
});

void test('matchesFreeSearch is case and accent insensitive', () => {
  // "societa" matches "Società"
  const q1 = parseFreeSearch('societa');
  assert.equal(matchesFreeSearch(sampleJob, q1), true);

  const q2 = parseFreeSearch('TORINO');
  assert.equal(matchesFreeSearch(sampleJob, q2), true);
});

void test('matchesAdvancedSearch handles mode all_words, exact_phrase, identical_field and wholeWordsOnly', () => {
  // all_words
  const adv1: AdvancedSearch = {
    mode: 'all_words',
    fields: { title: 'frontend developer' },
  };
  assert.equal(matchesAdvancedSearch(sampleJob, adv1), true);

  // exact_phrase
  const adv2: AdvancedSearch = {
    mode: 'exact_phrase',
    fields: { description: 'esperto in React' },
  };
  assert.equal(matchesAdvancedSearch(sampleJob, adv2), true);

  // identical_field: must match entire field exactly
  const adv3: AdvancedSearch = {
    mode: 'identical_field',
    fields: { location: 'Torino, Italia' },
  };
  assert.equal(matchesAdvancedSearch(sampleJob, adv3), true);

  const adv3Fail: AdvancedSearch = {
    mode: 'identical_field',
    fields: { location: 'Torino' },
  };
  assert.equal(matchesAdvancedSearch(sampleJob, adv3Fail), false);

  // wholeWordsOnly: "front" shouldn't match "Frontend" as a whole word
  const adv4: AdvancedSearch = {
    mode: 'all_words',
    wholeWordsOnly: true,
    fields: { title: 'front' },
  };
  assert.equal(matchesAdvancedSearch(sampleJob, adv4), false);

  const adv4Pass: AdvancedSearch = {
    mode: 'all_words',
    wholeWordsOnly: true,
    fields: { title: 'frontend' },
  };
  assert.equal(matchesAdvancedSearch(sampleJob, adv4Pass), true);
});

void test('matchesFreeSearch matches text in application notes and respects negative words in notes', () => {
  const jobWithNotes: JobRow = {
    ...sampleJob,
    application: {
      appliedAt: 1000,
      status: 'pending',
      closedAt: null,
      reason: null,
      notes: 'Contattato tramite messaggio su referral interno',
      interviews: [],
    },
  };

  // Positive match in notes
  const q1 = parseFreeSearch('referral');
  assert.equal(matchesFreeSearch(jobWithNotes, q1), true);

  // Phrase match in notes
  const q2 = parseFreeSearch('"referral interno"');
  assert.equal(matchesFreeSearch(jobWithNotes, q2), true);

  // Negative exclusion in notes
  const q3 = parseFreeSearch('frontend -referral');
  assert.equal(matchesFreeSearch(jobWithNotes, q3), false);

  // Job without application does not match note search
  assert.equal(matchesFreeSearch(sampleJob, q1), false);
});

void test('matchesAdvancedSearch filters by application notes field', () => {
  const jobWithNotes: JobRow = {
    ...sampleJob,
    application: {
      appliedAt: 1000,
      status: 'interviewing',
      closedAt: null,
      reason: null,
      notes: 'Colloquio tecnico concordato con responsabile engineering',
      interviews: [],
    },
  };

  const advPass: AdvancedSearch = {
    mode: 'exact_phrase',
    fields: { notes: 'responsabile engineering' },
  };
  assert.equal(matchesAdvancedSearch(jobWithNotes, advPass), true);

  const advFail: AdvancedSearch = {
    mode: 'exact_phrase',
    fields: { notes: 'colloquio HR' },
  };
  assert.equal(matchesAdvancedSearch(jobWithNotes, advFail), false);

  // Job with no application or empty notes fails advanced notes search
  assert.equal(matchesAdvancedSearch(sampleJob, advPass), false);
});

void test('highlightTerms collects positive terms from advanced search notes', () => {
  const terms = highlightTerms('', {
    mode: 'all_words',
    fields: { notes: 'referral interno' },
  });
  assert.ok(terms.includes('referral'));
  assert.ok(terms.includes('interno'));
});
