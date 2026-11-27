import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agencyDescription, agencyUrl } from './agency.ts';
import { createScorer } from './score.ts';
import { testProfile } from './harness.ts';

void test('AG4 contract and salary lead the description, count as normal weights, and never imply Stabile', () => {
  const profile = testProfile((p) => {
    Object.assign(p, { stable: { companies: [], sites: [] } });
    Object.assign(p.weights, { description: { 'tempo indeterminato': 3 } });
  });
  const scorer = createScorer(profile);
  for (const company of ['Randstad', 'Adecco', 'Gi Group', 'Umana']) {
    const description = agencyDescription('Tempo indeterminato', '€ 28000 annuale', '<p>TypeScript</p>');
    assert.equal(
      description.description.split('\n')[0],
      'Contratto: Tempo indeterminato · Retribuzione: € 28000 annuale',
    );
    const card = { title: 'Addetto', company, site: company.toLowerCase(), location: '', ...description };
    assert.equal(scorer.isStable(card), false);
    assert.equal(scorer.score(card).descriptionScore, 3);
    assert.equal(agencyDescription('Tempo determinato', undefined, '').description, 'Contratto: Tempo determinato');
    assert.equal(agencyDescription(undefined, undefined, '').description, 'Contratto: Non indicato');
  }
  const configured = createScorer(
    testProfile((p) => Object.assign(p, { stable: { companies: ['Officina Esempio'], sites: ['randstad'] } })),
  );
  assert.equal(configured.isStable({ title: 'Addetto', company: 'Randstad', site: 'randstad' }), true);
  assert.equal(configured.isStable({ title: 'Addetto', company: 'Officina Esempio', site: 'umana' }), true);
  assert.doesNotMatch(agencyDescription('<script>x</script>', '<img src=x>', '').descriptionHtml, /<script>|<img/u);
});

void test('agency links stay on the public HTTPS origin and expected path', () => {
  const base = 'https://jobs.example.org/offerte/';
  assert.equal(agencyUrl('/offerte/1/#details', base, '/offerte/'), 'https://jobs.example.org/offerte/1/');
  for (const url of [
    'https://other.example.org/offerte/1/',
    'http://jobs.example.org/offerte/1/',
    'https://user:pass@jobs.example.org/offerte/1/',
    '/unexpected/1/',
  ])
    assert.throws(() => agencyUrl(url, base, '/offerte/'));
});
