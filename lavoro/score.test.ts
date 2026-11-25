import assert from 'node:assert/strict';
import { test } from 'node:test';
import { profileSchema } from './config.ts';
import { inventedProfile } from './invented-profile.ts';
import { createScorer, type Posting } from './score.ts';

const scorer = createScorer(profileSchema.parse(inventedProfile()));
const posting = (extra: Partial<Posting>): Posting => ({
  title: 'Frontend developer',
  company: 'Acme',
  location: 'Exampleville, EV, Italia',
  ...extra,
});

void test('title, description and years add up to the score; place and mode add the bonus on top', () => {
  const result = scorer.score(
    posting({
      description: 'Stack: TypeScript, Docker. Richiesti almeno 2 anni di esperienza. Full remote.',
      declaredMode: 'remote',
    }),
  );
  assert.equal(result.titleScore, 5);
  assert.equal(result.descriptionScore, 3);
  assert.equal(result.yearsPenalty, 0);
  assert.equal(result.score, 8);
  assert.equal(result.locationBonus, 3);
  assert.equal(result.workModeBonus, 2);
  assert.equal(result.bonus, 5);
  assert.equal(result.total, 13);
  assert.equal(result.workMode, 'remote');
  assert.deepEqual(result.reasons, [
    'developer:+2',
    'frontend:+3',
    'typescript:+2 (descr.)',
    'docker:+1 (descr.)',
    '2 anni',
    'exampleville:+3 (sede)',
    'remote:+2 (modalità)',
  ]);
});

void test('more years than the profile allows cost 6 points and say so', () => {
  const result = scorer.score(posting({ description: 'Richiesti almeno 5 anni di esperienza.' }));
  assert.equal(result.yearsPenalty, -6);
  assert.equal(result.score, 5 - 6);
  assert.ok(result.reasons.includes('5+ anni:-6'));
});

void test('negative weights lower the score and show in the reasons', () => {
  const result = scorer.score(posting({ title: 'Senior RAG developer', description: 'Frequenti trasferte.' }));
  assert.equal(result.titleScore, 2 + 5 - 4);
  assert.ok(result.reasons.includes('senior:-4'));
  assert.ok(result.reasons.includes('trasferte:-1 (descr.)'));
});

void test('administrative electronic phrases do not score as technical electronics', () => {
  const profile = profileSchema.parse(inventedProfile());
  profile.weights.description = { elettronica: 2, posta: 1 };
  const electronics = createScorer(profile);
  assert.equal(
    electronics.score(posting({ description: 'Posta elettronica e fatturazione elettronica.' })).descriptionScore,
    1,
  );
  assert.equal(
    electronics.score(posting({ description: 'Posta elettronica. Diploma in elettronica.' })).descriptionScore,
    3,
  );
  assert.equal(
    electronics.score(posting({ description: "Documento: CIE (Carta d'identità elettronica)." })).descriptionScore,
    0,
  );
});

void test('Leonardo corporate sector boilerplate does not score or categorize as Elettronica', () => {
  const profile = profileSchema.parse(inventedProfile());
  profile.weights.description = { elettronica: 2, 'schede elettroniche': 2 };
  profile.categories = { ...profile.categories, Elettronica: ['elettronica', 'schede elettroniche'] };
  const electronics = createScorer(profile);
  const boilerplate =
    'Gruppo industriale in ambito Elicotteri, Velivoli, Aerostrutture, Elettronica, Cyber Security e Spazio.';
  assert.equal(electronics.score(posting({ description: boilerplate })).descriptionScore, 0);
  assert.deepEqual(electronics.categories(posting({ description: boilerplate })), ['Frontend']);
  const realMatch = `${boilerplate} Esperienza su schede elettroniche ed elettronica di potenza.`;
  assert.equal(electronics.score(posting({ description: realMatch })).descriptionScore, 4);
  assert.deepEqual(electronics.categories(posting({ description: realMatch })), ['Frontend', 'Elettronica']);
});

void test('bonuses never let a posting in: a role off topic is not selected for being in the right city', () => {
  const offTopic = scorer.score(posting({ title: 'Developer', declaredMode: 'remote' }));
  assert.equal(offTopic.titleScore, 2);
  assert.equal(offTopic.score, 2);
  assert.equal(offTopic.bonus, 5);
  assert.ok(offTopic.total >= 5, 'with its bonuses the posting would clear minScore (5)');
  assert.equal(scorer.isSelected(offTopic), false);
  assert.equal(scorer.isSelected(scorer.score(posting({ title: 'Frontend developer' }))), true);
});

void test('the title alone has to reach minTitleScore even when the description is rich', () => {
  const result = scorer.score(posting({ title: 'Sviluppatore', description: 'TypeScript Docker TypeScript' }));
  assert.equal(result.titleScore, 0);
  assert.equal(result.score, 3);
  const rich = scorer.score(posting({ title: 'Sviluppatore', description: 'typescript docker trasferte' }));
  assert.equal(scorer.isSelected({ score: 9, titleScore: rich.titleScore }), false);
});

void test('the thresholds are inclusive', () => {
  assert.equal(scorer.isSelected({ score: 5, titleScore: 2 }), true);
  assert.equal(scorer.isSelected({ score: 4, titleScore: 2 }), false);
  assert.equal(scorer.isSelected({ score: 5, titleScore: 1 }), false);
});

void test('the scorer filters by place and gives categories with the profile it was built from', () => {
  assert.equal(scorer.passesLocation(posting({})), true);
  assert.equal(scorer.passesLocation(posting({ location: 'Berlin, Germany' })), false);
  assert.deepEqual(scorer.categories(posting({ description: 'RAG with embeddings' })), ['RAG', 'Frontend']);
  assert.equal(scorer.scoreTitle('Frontend developer').score, 5);
});

void test('protected category positions are heavily penalized and rejected', () => {
  const protectedJob = scorer.score(
    posting({
      title: 'Frontend developer - Categorie Protette L. 68/99',
      description: 'React, TypeScript',
    }),
  );
  assert.ok(protectedJob.reasons.includes('categorie protette:-100'));
  assert.ok(protectedJob.score < 0);
  assert.equal(scorer.isSelected(protectedJob), false);

  const jobWithDisclaimer = scorer.score(
    posting({
      title: 'Frontend developer',
      description:
        'Lavoriamo in un ambiente inclusivo aperto a tutti indipendentemente da caratteristiche tutelate da legge 68/99.',
    }),
  );
  assert.equal(
    jobWithDisclaimer.reasons.some((r) => r.startsWith('categorie protette:')),
    false,
  );
  assert.equal(scorer.isSelected(jobWithDisclaimer), true);
});

// 16n1: the Stabile path. The invented profile has minScore 5 and minTitleScore 2; "Addetto" is worth nothing there.
const stableProfile = (stable: Record<string, unknown> = {}) =>
  profileSchema.parse({
    ...inventedProfile(),
    stable: {
      companies: ['Banca Esempio'],
      titleWeights: { addetto: 3, sportello: 2 },
      extraLocations: ['examplia west'],
      ...stable,
    },
  });
const stableScorer = createScorer(stableProfile());
const clerk = (extra: Partial<Posting> = {}) =>
  posting({ title: 'Addetto sportello', company: 'Banca Esempio S.p.A.', ...extra });

void test('without a stable section nothing about Stabile happens, even for a listed-looking posting', () => {
  const lookalike = clerk({ description: 'Contratto a tempo indeterminato. Laurea obbligatoria.' });
  const result = scorer.score(lookalike);
  assert.deepEqual(result.reasons, ['exampleville:+3 (sede)']);
  assert.equal(result.score, 0);
  assert.equal(scorer.isSelected(result), false);
  assert.deepEqual(scorer.categories(lookalike), []);
  assert.equal(scorer.isStable(lookalike), false);
});

void test('a Stabile posting skips the developer gates, is categorised and says why', () => {
  const result = stableScorer.score(clerk());
  assert.equal(result.titleScore, 0, 'the developer title score is untouched');
  assert.ok(result.reasons.includes('stabile:azienda'));
  assert.equal(stableScorer.isSelected(result), true);
  assert.deepEqual(stableScorer.categories(clerk()), ['Stabile']);
  assert.equal(scorer.isSelected(scorer.score(clerk())), false, 'the same posting without the section is not');
});

void test('every reason that holds is listed, and contract text alone does not trigger Stabile', () => {
  const byCompany = stableScorer.score(clerk({ description: 'Contratto a tempo indeterminato' }));
  assert.deepEqual(
    byCompany.reasons.filter((r) => r.startsWith('stabile:')),
    ['stabile:azienda'],
  );
  const byBoth = createScorer(stableProfile({ sites: ['reteinformaticalavoro'] })).score(
    clerk({ site: 'reteinformaticalavoro' }),
  );
  assert.deepEqual(
    byBoth.reasons.filter((r) => r.startsWith('stabile:')),
    ['stabile:azienda', 'stabile:fonte'],
  );
  const bySource = createScorer(stableProfile({ companies: [], sites: ['reteinformaticalavoro'] })).score(
    clerk({ company: 'Acme', site: 'reteinformaticalavoro' }),
  );
  assert.ok(bySource.reasons.includes('stabile:fonte'));
  const contractOnly = stableScorer.score(clerk({ company: 'Acme', description: 'Contratto a tempo indeterminato' }));
  assert.equal(
    contractOnly.reasons.some((r) => r.startsWith('stabile:')),
    false,
  );
  assert.equal(stableScorer.isSelected(contractOnly), false);
});

void test('a requirement drops a Stabile posting that only the Stabile rule let in, and says why', () => {
  const degree = stableScorer.score(clerk({ description: 'Laurea obbligatoria in economia.' }));
  assert.ok(degree.reasons.includes('escluso:laurea'));
  assert.equal(stableScorer.isSelected(degree), false);
  const licence = stableScorer.score(clerk({ title: 'Autista', description: 'Patente CE e CQC' }));
  assert.ok(licence.reasons.includes('escluso:patente'));
  const either = stableScorer.score(clerk({ description: 'Laurea o diploma. Patente B.' }));
  assert.equal(
    either.reasons.some((r) => r.startsWith('escluso:')),
    false,
  );
  assert.equal(stableScorer.isSelected(either), true);
});

void test('a developer posting that clears the gates on its own is never dropped by a requirement', () => {
  const developer = stableScorer.score(
    posting({ company: 'Banca Esempio', description: 'Laurea obbligatoria. TypeScript, Docker.' }),
  );
  assert.equal(
    developer.reasons.some((r) => r.startsWith('escluso:')),
    false,
  );
  assert.ok(developer.reasons.includes('stabile:azienda'));
  assert.equal(stableScorer.isSelected(developer), true);
  assert.equal(
    scorer.isSelected(scorer.score(posting({ description: 'Laurea obbligatoria. TypeScript, Docker.' }))),
    true,
  );
});

// 16n2 step 0: a Stabile posting enters only with a positive stable title weight hit and a score of at least 0.
void test('a Stabile posting without a positive title weight hit is not selected', () => {
  const designer = stableScorer.score(clerk({ title: 'Senior Brand Designer' }));
  assert.ok(designer.reasons.includes('stabile:azienda'), 'it is still Stabile');
  assert.equal(stableScorer.isSelected(designer), false);
  const listed = stableScorer.score(clerk({ title: 'Project Engineer' }));
  assert.equal(stableScorer.isSelected(listed), false, 'a listed employer is not enough either');
  const technician = createScorer(stableProfile({ companies: [], sites: ['inpa'] })).score(
    clerk({ title: 'Addetto', company: 'Acme', site: 'inpa' }),
  );
  assert.equal(stableScorer.isSelected(technician), true);
});

void test('stable.bonus raises bonus and total only after passing the floor, exclusions and years check', () => {
  const boosted = createScorer(stableProfile({ bonus: 10 }));
  const passing = boosted.score(clerk({ location: 'Torino, TO, Italia' }));
  assert.equal(passing.score, 5);
  assert.equal(passing.bonus, 10);
  assert.equal(passing.total, 15);
  assert.ok(passing.reasons.includes('stabile:+10 (azienda)'));
  assert.equal(boosted.isSelected(passing), true);

  const floorFailed = boosted.score(clerk({ title: 'Project Engineer', location: 'Torino, TO, Italia' }));
  assert.ok(floorFailed.reasons.includes('stabile:sotto soglia'));
  assert.equal(floorFailed.bonus, 0);
  assert.equal(boosted.isSelected(floorFailed), false);

  const overYears = boosted.score(
    clerk({ location: 'Torino, TO, Italia', description: 'Richiesti 5 anni di esperienza.' }),
  );
  assert.ok(overYears.reasons.includes('stabile:sotto soglia'));
  assert.equal(overYears.bonus, 0);
  assert.equal(boosted.isSelected(overYears), false);

  const degreeExcluded = boosted.score(clerk({ location: 'Torino, TO, Italia', description: 'Laurea obbligatoria.' }));
  assert.ok(degreeExcluded.reasons.includes('escluso:laurea'));
  assert.equal(degreeExcluded.bonus, 0);
  assert.equal(boosted.isSelected(degreeExcluded), false);

  const protectedExcluded = boosted.score(
    clerk({ location: 'Torino, TO, Italia', description: 'Riservato categorie protette L. 68/99.' }),
  );
  assert.ok(protectedExcluded.reasons.includes('categorie protette:-100'));
  assert.equal(protectedExcluded.bonus, 0);
  assert.equal(boosted.isSelected(protectedExcluded), false);
});

void test('a Stabile posting with a negative score is not selected whatever its title weights', () => {
  const negative = stableScorer.score(clerk({ title: 'Addetto contabile' }));
  assert.equal(negative.score, 3 - 8);
  assert.equal(stableScorer.isSelected(negative), false);
  const zero = stableScorer.score(clerk({ title: 'Addetto trasferte', description: 'trasferte' }));
  assert.equal(stableScorer.isSelected(zero), true, 'a score of exactly 0 or more stays');
});

void test('a negative title weight alone is not a hit', () => {
  const profile = createScorer(stableProfile({ titleWeights: { addetto: -1, sportello: 2 } }));
  assert.equal(profile.isSelected(profile.score(clerk({ title: 'Addetto' }))), false);
  assert.equal(profile.isSelected(profile.score(clerk({ title: 'Addetto sportello' }))), true);
});

void test('the floor never rejects a developer posting that clears the gates on its own', () => {
  const developer = stableScorer.score(posting({ title: 'Frontend developer rag', company: 'Banca Esempio' }));
  assert.ok(developer.reasons.includes('stabile:azienda'));
  assert.equal(stableScorer.isSelected(developer), true);
});

void test('an on-site job far away with an "Ibrido/da remoto" line does not pass the location filter', () => {
  const far = clerk({ location: 'Berlin, Germany', description: 'Sede di lavoro: Ibrido/da remoto (Berlin)' });
  assert.equal(stableScorer.score(far).workMode, 'hybrid');
  assert.equal(stableScorer.passesLocation(far), false);
});

void test('protected categories still win over Stabile', () => {
  const result = stableScorer.score(clerk({ description: 'Riservato alle categorie protette L. 68/99' }));
  assert.ok(result.reasons.includes('categorie protette:-100'));
  assert.equal(stableScorer.isSelected(result), false);
});

void test('titleWeights rank a Stabile posting and a positive hit is what lets it in', () => {
  const plain = createScorer(stableProfile({ titleWeights: {} }));
  const ranked = stableScorer.score(clerk());
  const unranked = plain.score(clerk());
  assert.equal(ranked.score - unranked.score, 5);
  assert.equal(ranked.total - unranked.total, 5);
  assert.equal(ranked.titleScore, unranked.titleScore);
  assert.ok(ranked.reasons.includes('addetto:+3') && ranked.reasons.includes('sportello:+2'));
  // 16n2 step 0 (owner decision): without a positive weight hit a Stabile posting no longer enters on Stabile alone.
  assert.equal(plain.isSelected(unranked), false);
  assert.equal(stableScorer.isSelected(ranked), true);
  const outsider = stableScorer.score(clerk({ company: 'Acme' }));
  assert.equal(outsider.score, 0, 'weights apply only to Stabile postings');
  assert.equal(stableScorer.isSelected(outsider), false);
});

void test('extraLocations widen the places for Stabile postings only', () => {
  const west = { location: 'Examplia West, Italia' };
  assert.equal(stableScorer.passesLocation(clerk(west)), true);
  assert.equal(stableScorer.passesLocation(clerk({ location: 'Berlin, Germany' })), false);
  assert.equal(stableScorer.passesLocation(posting({ ...west, location: 'Examplia West, Germany' })), false);
  // A developer posting is not widened: the same place, an employer that is not listed.
  assert.equal(stableScorer.passesLocation(posting({ location: 'Examplia West, Germany', company: 'Acme' })), false);
  assert.equal(stableScorer.passesLocation(clerk({ company: 'Acme', location: 'Examplia West, Germany' })), false);
  assert.equal(stableScorer.passesLocation(clerk({ location: 'Examplia West, Germany' })), true);
});

void test('glued CamelCase title tokens match split keywords without false-positives on weighted compounds', () => {
  const custom = profileSchema.parse(inventedProfile());
  custom.weights.title = {
    pcb: 3,
    junior: 3,
    javascript: 3,
    java: 4,
    sveltekit: 5,
    svelte: 6,
    frontend: 5,
    'front end': 5,
    'devops engineer': 2,
    sales: -8,
  };
  const customScorer = createScorer(custom);

  const texa = customScorer.scoreTitle('PCB DesignerJunior');
  assert.equal(texa.score, 6);
  assert.deepEqual(texa.reasons, ['pcb:+3', 'junior:+3']);

  const glued = customScorer.scoreTitle('PCBDesigner');
  assert.equal(glued.score, 3);
  assert.deepEqual(glued.reasons, ['pcb:+3']);

  assert.deepEqual(customScorer.scoreTitle('JavaScript Developer').reasons, ['javascript:+3']);
  assert.deepEqual(customScorer.scoreTitle('SvelteKit Developer').reasons, ['sveltekit:+5']);
  assert.deepEqual(customScorer.scoreTitle('FrontEnd Developer').reasons, ['frontend:+5']);
  assert.deepEqual(customScorer.scoreTitle('DevOps Engineer').reasons, ['devops engineer:+2']);
});
