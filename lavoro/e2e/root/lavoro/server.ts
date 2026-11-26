import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RUN_TMP } from '../../../../../apps/e2e/tests/hosts.ts';
import { defineModule } from '../../../../../apps/server/src/core/module.ts';
import { holdFile } from '../../hold.ts';
import { profileSchema } from '../../../config.ts';
import { createFakeSource, makeCard } from '../../../fake-source.ts';
import { inventedProfile } from '../../../invented-profile.ts';
import { blacklistRules, jobApplied, jobInterview, jobs, nearMisses } from '../../../schema.ts';
import { createLavoroModule } from '../../../server.ts';

const raw = inventedProfile();
// 0 pauses so e2e is fast
raw.search.pauseSeconds = 0;
raw.search.sites = ['indeed', 'reteinformaticalavoro', 'linkedin'];
raw.filter.minScore = -10;
raw.filter.minTitleScore = -10;
// 16n1: one listed employer, so the categories filter has a Stabile entry. The gates are open here (-10), so only
// the category tells it apart.
const profile = profileSchema.parse({
  ...raw,
  stable: { companies: ['Banca Esempio'] },
  parere: { key: 'invented-key', profile: 'Profilo inventato' },
  // The fake desktop's `work` mail is dated November 2026: a long window keeps it readable whenever the suite runs.
  mailCheck: { accounts: ['work'], windowDays: 3650, todoDays: 3650 },
});

export const fakeCards = [
  makeCard('indeed', 1, {
    title: 'Frontend Developer React',
    company: 'Acme Corp',
    location: 'Exampleville',
    description: 'We are looking for a frontend developer with React experience and modern web standards.',
    declaredMode: 'remote',
  }),
  makeCard('reteinformaticalavoro', 2, {
    title: 'Web Developer Junior',
    company: 'Beta Systems',
    location: 'Examplia North',
    description: 'Junior web developer for UI components and interactive charts.',
    declaredMode: 'hybrid',
  }),
  makeCard('linkedin', 3, {
    title: 'Frontend Engineer Vue',
    company: 'Gamma Tech',
    location: 'Exampleville',
    description: 'Vue.js and TypeScript developer with frontend experience.',
    declaredMode: 'remote',
  }),
  makeCard('indeed', 4, {
    title: 'Fullstack Developer Web',
    company: 'Delta Solutions',
    location: 'Exampleville',
    description: 'Fullstack engineer with Node and modern frontend frameworks.',
    declaredMode: 'onsite',
  }),
  makeCard('reteinformaticalavoro', 5, {
    title: 'Senior Frontend Architect',
    // Same company as the Vue posting once the legal form is ignored: the "already applied" badge needs a pair.
    company: 'Gamma Tech S.r.l.',
    location: 'Exampleville',
    description: 'Senior lead architect for complex web applications.',
    declaredMode: 'remote',
  }),
  makeCard('indeed', 7, {
    title: 'Addetto sportello',
    company: 'Banca Esempio S.p.A.',
    location: 'Exampleville',
    description:
      'Sportello clienti. Contratto a tempo indeterminato. Laurea o diploma. Retribuzione: 1.800 - 2.000 €/mese.',
    declaredMode: 'onsite',
  }),
  makeCard('linkedin', 6, {
    title: 'React Native Developer',
    company: 'Zeta Mobile',
    location: 'Examplia North',
    description: 'Mobile frontend developer for iOS and Android apps.',
    declaredMode: 'remote',
  }),
];

function held(source: ReturnType<typeof createFakeSource>): ReturnType<typeof createFakeSource> {
  return {
    ...source,
    async search(input, context) {
      while (existsSync(holdFile) && !context.signal.aborted) await context.sleep(50);
      return source.search(input, context);
    },
  };
}

const fixtureRoot = join(RUN_TMP, 'lavoro-notes');
const fixtureDir = join(fixtureRoot, 'candidature', 'next-wave_principal-engineer');
mkdirSync(fixtureDir, { recursive: true });
mkdirSync(join(RUN_TMP, 'candidatura'), { recursive: true });
writeFileSync(join(RUN_TMP, 'candidatura', 'SKILL.md'), '# Synthetic candidatura skill\n');
writeFileSync(join(RUN_TMP, 'paths.local.json'), JSON.stringify({ folder: fixtureRoot }));
writeFileSync(
  join(fixtureDir, 'colloquio-2026-11-17.md'),
  '# Preparazione\n\n**In breve**\n- Fase tecnica\n\n---\n\n## Contesto\n- Primo argomento\n\n## Domande\n### Esempio\nRisposta preparata',
);
writeFileSync(
  join(fixtureRoot, 'candidature', 'lacune-2026-11-17.md'),
  '# Lacune\n\n## In breve\n- Competenza da studiare',
);

const baseModule = createLavoroModule({
  skillsDir: RUN_TMP,
  profile,
  sources: [
    held(
      createFakeSource({
        name: 'indeed',
        describe: () => 'Testo recuperato dal sito.',
        delayMs: 200,
        catalog: () => fakeCards.filter((c) => c.site === 'indeed'),
      }),
    ),
    held(
      createFakeSource({
        name: 'reteinformaticalavoro',
        kind: 'list',
        delayMs: 200,
        catalog: () => fakeCards.filter((c) => c.site === 'reteinformaticalavoro'),
      }),
    ),
    held(
      createFakeSource({
        name: 'linkedin',
        delayMs: 200,
        catalog: () => fakeCards.filter((c) => c.site === 'linkedin'),
      }),
    ),
  ],
  lookup: async () => ['93.184.216.34'],
  fetch: async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const body = typeof init?.body === 'string' ? init.body : '';
    if (url.startsWith('https://generativelanguage.googleapis.com/')) {
      return Response.json({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    codes: body.includes('Web Developer Junior')
                      ? ['domain', 'location']
                      : ['domain', 'location', 'salary'],
                    verdict: body.includes('Web Developer Junior')
                      ? 'media'
                      : body.includes('Fullstack Developer Web')
                        ? 'bassa'
                        : 'alta',
                    why: 'Ruolo coerente',
                    fit: ['Competenze'],
                    contro: ['Sede'],
                    next: 'Scrivi al referente',
                    unverified: ['Azienda'],
                  }),
                },
              ],
            },
          },
        ],
      });
    }
    // The mail check's local model (step 51): an invented answer per mail, never a real model.
    if (url === 'http://127.0.0.1:11434/api/chat') {
      const prompt: string = JSON.parse(body).messages[0].content;
      const candidate = /(A\d+): Next Wave/.exec(prompt)?.[1] ?? 'nessuna';
      const answer = {
        application: 'nessuna',
        confidence: 'bassa',
        kind: 'altro',
        why: 'Mail di prova',
        interviewDate: '',
        interviewTime: '',
        interviewPlace: '',
        ask: '',
        deadline: '',
      };
      if (prompt.includes('Oggetto: Offerta di colloquio\n'))
        Object.assign(answer, {
          application: candidate,
          confidence: 'media',
          kind: 'invito',
          why: 'Propone un colloquio',
          interviewDate: '2030-01-15',
          interviewTime: '10:00',
          interviewPlace: 'Sede esempio https://meet.example.test/abc',
        });
      if (prompt.includes('Oggetto: Re: Domanda sul ruolo\n'))
        Object.assign(answer, {
          ask: 'Rispondere con la disponibilità su https://calendly.example.test/slot',
          deadline: '2030-01-10',
        });
      return Response.json({ message: { content: JSON.stringify(answer) } });
    }
    if (url === 'https://example.com/fixture-job') {
      const html = `
        <!doctype html>
        <html>
          <head>
            <title>Fixture React Dev - TechCorp</title>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "JobPosting",
                "title": "Fixture React Dev",
                "hiringOrganization": { "@type": "Organization", "name": "TechCorp" },
                "jobLocation": { "@type": "Place", "address": { "@type": "PostalAddress", "addressLocality": "Milano" } },
                "description": "Cerchiamo frontend engineer React senior con esperienza.",
                "jobLocationType": "TELECOMMUTE"
              }
            </script>
          </head>
          <body></body>
        </html>
      `;
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response('Not found', { status: 404 });
  },
});

export default defineModule({
  name: 'lavoro',
  optional: baseModule.optional,
  config: baseModule.config,
  settingsSchema: profileSchema,
  migrations: baseModule.migrations,
  create(deps) {
    // Seed initial blacklist rule for Zeta Mobile so it is blacklisted upon collection
    const existingRule = deps.db.select().from(blacklistRules).limit(1).get();
    if (!existingRule) {
      deps.db
        .insert(blacklistRules)
        .values({
          enabled: true,
          field: 'company',
          matchType: 'contains',
          value: 'Zeta Mobile',
          note: 'Agenzia indesiderata',
          createdAt: new Date(),
        })
        .run();
    }

    const dayMs = 24 * 60 * 60 * 1000;
    // Step 77: two postings the gates refused by a few points. The first is read by the Statistiche spec, the second
    // is added by hand by the last spec of the file (it changes the list, so nothing runs after it).
    if (!deps.db.select().from(nearMisses).limit(1).get()) {
      const near = {
        company: 'Near Works',
        location: 'Exampleville',
        site: 'indeed',
        total: 3,
        minScore: 5,
        minTitleScore: 2,
        firstSeen: new Date(),
        lastSeen: new Date(),
      };
      deps.db
        .insert(nearMisses)
        .values([
          {
            ...near,
            key: 'near-works-tecnico-manutentore',
            url: 'https://example.com/near/1',
            title: 'Tecnico manutentore',
            score: 3,
            titleScore: 2,
            reasons: ['tecnico:+2', 'manutentore:+1'],
            description: 'Manutenzione di impianti.',
          },
          {
            ...near,
            key: 'near-works-addetto-manutentore',
            url: 'https://example.com/near/2',
            company: 'Near Works Due',
            title: 'Addetto manutentore',
            score: 4,
            titleScore: 2,
            reasons: ['manutentore:+2'],
            description: 'Testo salvato per Aggiungi.',
          },
          {
            ...near,
            key: 'near-works-cablatore-quadri',
            url: 'https://example.com/near/3',
            company: 'Near Works Tre',
            title: 'Cablatore quadri',
            score: 3,
            titleScore: 2,
            reasons: ['cablatore:+3', 'stabile:azienda', 'stabile:sotto soglia'],
            description: 'Cablaggio quadri elettrici.',
          },
          {
            ...near,
            key: 'near-works-perito-elettrotecnico', // guard-private: allow Synthetic fixture identifier
            url: 'https://example.com/near/4',
            company: 'Near Works Quattro',
            title: 'Perito elettrotecnico',
            score: 3,
            titleScore: 2,
            reasons: ['perito:+3'],
            description: 'Collaudi e manutenzione.',
          },
        ])
        .run();
    }
    const existingJobs = deps.db.select().from(jobs).limit(1).get();
    if (!existingJobs) {
      // Seed initial applications for e2e tests
      // 1. Expired application (> 21 days ago, pending, no interviews, imported url)
      deps.db
        .insert(jobs)
        .values({
          key: 'fake-expired-key',
          comparisonKey: 'old-corp-lead-architect',
          title: 'Lead Architect',
          company: 'Old Corp',
          location: 'Exampleville',
          site: 'sito',
          url: 'urn:import:fake-expired-key',
          score: 8,
          total: 8,
          reasons: ['Architettura'],
          categories: ['dev'],
          description: 'Ruolo di lead architect legacy',
          isRemote: false,
          detailsMissing: true,
          firstSeen: new Date(Date.now() - 30 * dayMs),
        })
        .run();
      deps.db
        .insert(jobApplied)
        .values({
          key: 'fake-expired-key',
          appliedAt: new Date(Date.now() - 25 * dayMs),
          status: 'pending',
        })
        .run();

      // 2. Active application with interview (> 21 days ago, interviewing, with interview)
      deps.db
        .insert(jobs)
        .values({
          key: 'fake-interview-key',
          comparisonKey: 'next-wave-principal-engineer',
          title: 'Principal Engineer',
          company: 'Next Wave',
          location: 'Exampleville',
          site: 'linkedin',
          url: 'https://example.com/job/fake-interview',
          score: 9,
          total: 9,
          reasons: ['Cloud'],
          categories: ['dev'],
          description: 'Sistemi distribuiti',
          isRemote: true,
          detailsMissing: false,
          firstSeen: new Date(Date.now() - 30 * dayMs),
        })
        .run();
      deps.db
        .insert(jobApplied)
        .values({
          key: 'fake-interview-key',
          appliedAt: new Date(Date.now() - 25 * dayMs),
          status: 'interviewing',
        })
        .run();
      deps.db
        .insert(jobInterview)
        .values({
          key: 'fake-interview-key',
          scheduledAt: new Date(Date.now() + 2 * dayMs),
          label: 'Colloquio tecnico',
        })
        .run();

      // 3. Closed application (rejected)
      deps.db
        .insert(jobs)
        .values({
          key: 'fake-rejected-key',
          comparisonKey: 'past-systems-staff-developer',
          title: 'Staff Developer',
          company: 'Past Systems',
          location: 'Exampleville',
          site: 'agenzia',
          url: 'urn:import:fake-rejected-key',
          score: 7,
          total: 7,
          reasons: ['Backend'],
          categories: ['dev'],
          description: 'Full stack development',
          isRemote: false,
          detailsMissing: true,
          firstSeen: new Date(Date.now() - 40 * dayMs),
        })
        .run();
      deps.db
        .insert(jobApplied)
        .values({
          key: 'fake-rejected-key',
          appliedAt: new Date(Date.now() - 35 * dayMs),
          closedAt: new Date(Date.now() - 20 * dayMs),
          status: 'rejected',
          reason: 'Posizione chiusa internamente',
        })
        .run();
    }
    return baseModule.create(deps);
  },
});
