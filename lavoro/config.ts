import { z } from '../../apps/server/src/core/module.ts';
import { providers } from './opinion-prompt.ts';
import { isPublicHostname } from './public-host.ts';

// The strict profile of the Lavoro module (`modules.lavoro` in the local config). camelCase keys, same shape as
// plans/16b-profile-draft.md: change the schema and the draft together, never one silently.

const sites = [
  'indeed',
  'reteinformaticalavoro',
  'linkedin',
  'inpa',
  'iren',
  'successfactors',
  'oracle',
  'avature',
  'manpower',
  'workday',
  'synergie',
] as const;
const siteLabels = {
  indeed: 'Indeed',
  reteinformaticalavoro: 'Rete Informatica Lavoro',
  linkedin: 'LinkedIn',
  inpa: 'inPA',
  iren: 'IRENfutura',
  successfactors: 'SuccessFactors',
  oracle: 'Oracle',
  avature: 'Avature',
  manpower: 'Manpower',
  workday: 'Workday',
  synergie: 'Synergie',
};
const site = z.enum(sites).meta({ optionLabels: siteLabels });
const count = z.number().int().positive();
const seconds = z.number().int().positive();
// LinkedIn f_E codes, as listed in plans/refs/job-radar-design.md.
const experience = z.array(z.number().int().min(1).max(6)).meta({
  optionLabels: { 1: 'Tirocinio', 2: 'Entry level', 3: 'Associate', 4: 'Mid-senior', 5: 'Director', 6: 'Executive' },
});
// LinkedIn f_WT codes, same source.
const workTypes = z.array(z.number().int().min(1).max(3)).meta({
  optionLabels: { 1: 'In sede', 2: 'Remoto', 3: 'Ibrido' },
});
const sortBy = z.enum(['DD', 'R']).meta({ optionLabels: { DD: 'Più recenti', R: 'Più rilevanti' } });
const words = z.array(z.string().min(1));
const weightMap = z.record(z.string().min(1), z.number().int());

// A query overrides only these keys of `search`; anything else in it is a typo and blocks the profile.
const query = z
  .strictObject({
    name: z.string().min(1).meta({ title: 'Nome', description: 'Etichetta della ricerca, usata per riconoscerla.' }),
    keywords: z.string().min(1).meta({ title: 'Parole chiave', description: 'Testo cercato nei portali.' }),
    indeedTerms: words
      .default([])
      .meta({ title: 'Termini Indeed', description: 'Termini extra solo per Indeed; se vuoto usa le parole chiave.' }),
    sites: z
      .array(site)
      .min(1)
      .optional()
      .meta({ title: 'Portali', description: 'Portali di questa ricerca; se vuoto usa quelli generali.' }),
    location: z
      .string()
      .min(1)
      .optional()
      .meta({ title: 'Luogo', description: 'Luogo di questa ricerca; se vuoto usa quello generale.' }),
    geoId: z.string().min(1).optional().meta({
      title: 'Codice luogo LinkedIn',
      description: 'Codice geografico di LinkedIn per questa ricerca; se vuoto usa quello generale.',
    }),
    experience: experience.optional().meta({
      title: 'Esperienza',
      description: 'Livelli di esperienza di questa ricerca su LinkedIn; se vuoto usa quelli generali.',
    }),
    workTypes: workTypes.optional().meta({
      title: 'Modalità',
      description: 'Modalità di lavoro di questa ricerca su LinkedIn; se vuoto usa quelle generali.',
    }),
    sortBy: sortBy.optional().meta({
      title: 'Ordinamento',
      description: 'Come LinkedIn ordina i risultati di questa ricerca; se vuoto usa quello generale.',
    }),
    maxResults: count.optional().meta({
      title: 'Risultati massimi',
      description: 'Quanti annunci leggere al massimo per questa ricerca; se vuoto usa il limite generale.',
      unit: 'annunci',
    }),
    knownPagesToStop: z.number().int().nonnegative().optional().meta({
      title: 'Pagine note per fermarsi',
      description:
        'Dopo quante pagine già viste la ricerca si ferma; 0 non si ferma mai, se vuoto usa il valore generale.',
      unit: 'pagine',
    }),
  })
  .meta({
    title: 'Ricerca',
    description: 'Una ricerca con le sue parole chiave; sostituisce solo i valori che imposti.',
  });

const linkedin = z
  .strictObject({
    geoId: z.string().min(1).optional().meta({
      title: 'Codice luogo',
      description: 'Codice geografico di LinkedIn; se vuoto cerca in base al nome del luogo.',
    }),
    sortBy: sortBy.default('DD').meta({ title: 'Ordinamento', description: 'Come LinkedIn ordina i risultati.' }),
    experience: experience
      .default([])
      .meta({ title: 'Esperienza', description: 'Livelli di esperienza richiesti; se vuoto tutti.' }),
    workTypes: workTypes
      .default([])
      .meta({ title: 'Modalità di lavoro', description: 'Dove si svolge il lavoro; se vuoto tutte.' }),
    minIntervalSeconds: seconds.default(4).meta({
      manual: true,
      title: 'Pausa tra richieste',
      description: 'Attesa minima tra due richieste a LinkedIn.',
      unit: 'secondi',
    }),
    maxRequests: count.default(180).meta({
      manual: true,
      title: 'Richieste massime',
      description: 'Quante richieste fare al massimo in una raccolta.',
      unit: 'richieste',
    }),
    backoffSeconds: seconds.default(30).meta({
      title: 'Attesa dopo un blocco',
      description: 'Attesa iniziale quando LinkedIn rifiuta una richiesta; raddoppia a ogni tentativo.',
      unit: 'secondi',
    }),
    maxBackoffSeconds: seconds.default(120).meta({
      title: 'Attesa massima',
      description: "Limite oltre cui l'attesa dopo un blocco non cresce.",
      unit: 'secondi',
    }),
    maxAttempts: count
      .default(3)
      .meta({ title: 'Tentativi', description: 'Quante volte riprovare una richiesta fallita.', unit: 'tentativi' }),
    maxConsecutive429: count.default(3).meta({
      title: 'Rifiuti consecutivi',
      description: 'Dopo quanti rifiuti di fila LinkedIn viene messo da parte.',
      unit: 'rifiuti',
    }),
    retryBudgetSeconds: seconds.default(300).meta({
      title: 'Tempo massimo di retry',
      description: 'Tempo totale da dedicare ai tentativi prima di arrendersi.',
      unit: 'secondi',
    }),
  })
  .meta({ title: 'LinkedIn', description: 'Come cercare e quanto andare piano su LinkedIn.' });

// inPA uses its own region ids, read page by page.
const inpa = z
  .strictObject({
    regionId: z.number().int().positive().meta({ title: 'Regione', description: 'Codice della regione secondo inPA.' }),
    pageSize: count
      .default(100)
      .meta({ title: 'Annunci per pagina', description: 'Quanti annunci chiedere a ogni pagina.', unit: 'annunci' }),
    maxPages: count
      .default(5)
      .meta({ title: 'Pagine massime', description: 'Quante pagine leggere al massimo.', unit: 'pagine' }),
  })
  .meta({ title: 'inPA', description: 'Lettura dei concorsi pubblici di una regione.' });

// IRENfutura (16n3a): the board's own region codes, `02` is Piemonte, `01` Emilia, `03` Liguria, `04` other regions.
const iren = z
  .strictObject({
    regions: z
      .array(z.string().regex(/^\d{2}$/u))
      .min(1)
      .meta({
        title: 'Regioni',
        description: 'Codici regione di IRENfutura: 02 Piemonte, 01 Emilia, 03 Liguria, 04 altre regioni.',
      }),
  })
  .meta({ title: 'IRENfutura', description: 'Annunci di IREN per le regioni scelte.' });

const publicHostRegex = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/iu;
const isValidEmployerHost = (value: string) => publicHostRegex.test(value) && isPublicHostname(value);

const successfactors = z
  .strictObject({
    employers: z
      .array(
        z.strictObject({
          host: z.string().refine(isValidEmployerHost).meta({
            manual: true,
            title: 'Sito',
            description: 'Indirizzo del sito carriere, senza https://.',
          }),
          company: z
            .string()
            .min(1)
            .meta({ title: 'Azienda', description: 'Nome mostrato sugli annunci di questo sito.' }),
        }),
      )
      .min(1)
      .meta({ title: 'Aziende', description: 'Siti carriere SuccessFactors da leggere.' }),
    places: words.min(1).meta({ title: 'Luoghi', description: 'Luoghi cercati su ogni sito.' }),
    maxPages: count
      .default(10)
      .meta({ title: 'Pagine massime', description: 'Quante pagine leggere al massimo per sito.', unit: 'pagine' }),
  })
  .meta({ title: 'SuccessFactors', description: 'Annunci dei siti carriere basati su SuccessFactors.' });

const oracle = z
  .strictObject({
    employers: z
      .array(
        z.strictObject({
          host: z.string().refine(isValidEmployerHost).meta({
            manual: true,
            title: 'Sito',
            description: "Indirizzo del sito Oracle dell'azienda, senza https://.",
          }),
          site: z
            .string()
            .regex(/^CX_\d+$/u)
            .meta({ title: 'Codice sito', description: 'Codice del sito carriere, nella forma CX_1.' }),
          company: z
            .string()
            .min(1)
            .meta({ title: 'Azienda', description: 'Nome mostrato sugli annunci di questo sito.' }),
        }),
      )
      .min(1)
      .meta({ title: 'Aziende', description: 'Siti carriere Oracle da leggere.' }),
    maxPages: count
      .default(10)
      .meta({ title: 'Pagine massime', description: 'Quante pagine leggere al massimo per sito.', unit: 'pagine' }),
  })
  .meta({ title: 'Oracle', description: 'Annunci dei siti carriere basati su Oracle.' });

const avature = z
  .strictObject({
    employers: z
      .array(
        z.strictObject({
          listUrl: z
            .url()
            .refine((value) => {
              if (!URL.canParse(value) || /qtvc/iu.test(value)) return false;
              const url = new URL(value);
              return (
                url.protocol === 'https:' &&
                isPublicHostname(url.hostname) &&
                !url.search &&
                !url.hash &&
                !url.username &&
                !url.password
              );
            })
            .meta({
              manual: true,
              title: 'Indirizzo elenco',
              description: "Indirizzo https della pagina con l'elenco degli annunci, senza parametri.",
            }),
          company: z
            .string()
            .min(1)
            .meta({ title: 'Azienda', description: 'Nome mostrato sugli annunci di questo sito.' }),
          country: z
            .string()
            .meta({ title: 'Paese', description: 'Paese da cercare sul sito; se vuoto nessun filtro.' }),
        }),
      )
      .min(1)
      .meta({ title: 'Aziende', description: 'Elenchi di annunci Avature da leggere.' }),
    maxPages: count
      .default(25)
      .meta({ title: 'Pagine massime', description: 'Quante pagine leggere al massimo per elenco.', unit: 'pagine' }),
  })
  .meta({ title: 'Avature', description: 'Annunci dei siti carriere basati su Avature.' });

const slug = z.string().regex(/^[a-z-]+$/u);
const manpower = z
  .strictObject({
    city: slug.meta({ title: 'Città', description: "Città cercata, scritta come nell'indirizzo di Manpower." }),
    functions: z
      .array(slug)
      .min(1)
      .meta({ title: 'Funzioni', description: "Aree di lavoro da cercare, scritte come nell'indirizzo di Manpower." }),
    maxPages: count
      .default(5)
      .meta({ title: 'Pagine massime', description: 'Quante pagine leggere al massimo per funzione.', unit: 'pagine' }),
  })
  .meta({ title: 'Manpower', description: "Annunci dell'agenzia Manpower per una città." });

const workday = z
  .strictObject({
    employers: z
      .array(
        z.strictObject({
          host: z.string().refine(isValidEmployerHost).meta({
            manual: true,
            title: 'Sito',
            description: "Indirizzo del sito Workday dell'azienda, senza https://.",
          }),
          tenant: z
            .string()
            .regex(/^[A-Za-z0-9_-]+$/u)
            .meta({ title: 'Tenant', description: 'Identificativo azienda nel percorso Workday.' }),
          site: z
            .string()
            .regex(/^[A-Za-z0-9_-]+$/u)
            .meta({ title: 'Codice sito', description: 'Nome del sito carriere nel percorso Workday.' }),
          company: z
            .string()
            .min(1)
            .meta({ title: 'Azienda', description: 'Nome mostrato sugli annunci di questo sito.' }),
          searchText: z
            .string()
            .default('')
            .meta({ title: 'Filtro testo', description: 'Testo opzionale inviato alla ricerca Workday.' }),
        }),
      )
      .min(1)
      .meta({ title: 'Aziende', description: 'Siti carriere Workday da leggere.' }),
    maxPages: count
      .default(10)
      .meta({ title: 'Pagine massime', description: 'Quante pagine leggere al massimo per sito.', unit: 'pagine' }),
  })
  .meta({ title: 'Workday', description: 'Annunci dei siti carriere basati su Workday.' });

const synergieRegion = z.string().regex(/^[\p{L}\s'-]+$/u);
const synergie = z
  .strictObject({
    regions: z
      .array(synergieRegion)
      .min(1)
      .meta({ title: 'Regioni', description: 'Regioni cercate su Synergie Italia.' }),
    maxPages: count
      .default(10)
      .meta({ title: 'Pagine massime', description: 'Quante pagine leggere al massimo per regione.', unit: 'pagine' }),
  })
  .meta({ title: 'Synergie', description: "Annunci dell'agenzia Synergie Italia per regione." });

const search = z
  .strictObject({
    sites: z.array(site).min(1).meta({ title: 'Portali', description: 'I portali in cui cercare.' }),
    location: z.string().min(1).meta({ title: 'Luogo', description: 'Città o zona da cercare.' }),
    hoursOld: z.number().int().positive().meta({
      title: 'Età massima',
      description: 'Si cercano solo annunci pubblicati da meno di questo tempo.',
      unit: 'ore',
    }),
    maxResultsPerQuery: count.default(100).meta({
      title: 'Risultati per ricerca',
      description: 'Quanti annunci leggere al massimo per ogni ricerca.',
      unit: 'annunci',
    }),
    // 0 means never stop on known pages / never remember seen postings.
    knownPagesToStop: z.number().int().nonnegative().default(1).meta({
      title: 'Pagine note per fermarsi',
      description: 'Dopo quante pagine di annunci già visti la ricerca si ferma; 0 non si ferma mai.',
      unit: 'pagine',
    }),
    knownDays: z.number().int().nonnegative().default(7).meta({
      title: 'Memoria annunci',
      description: 'Per quanti giorni un annuncio già valutato non viene riletto; 0 spegne la memoria.',
      unit: 'giorni',
    }),
    workersPerSite: count.default(1).meta({
      title: 'Richieste in parallelo',
      description: 'Quante ricerche contemporanee per portale.',
      unit: 'richieste',
    }),
    pauseSeconds: z.number().int().nonnegative().default(0).meta({
      title: 'Pausa tra ricerche',
      description: 'Attesa minima tra due ricerche sullo stesso portale; 0 nessuna pausa.',
      unit: 'secondi',
    }),
    workersBySite: z
      .strictObject(Object.fromEntries(sites.map((name) => [name, count.optional()])))
      .default({})
      .meta({
        title: 'Parallelismo per portale',
        description: 'Sostituisce le richieste in parallelo per un portale; se vuoto vale il valore generale.',
      }),
    linkedin: linkedin.default(linkedin.parse({})),
    inpa: inpa.optional(),
    iren: iren.optional(),
    successfactors: successfactors.optional(),
    oracle: oracle.optional(),
    avature: avature.optional(),
    manpower: manpower.optional(),
    workday: workday.optional(),
    synergie: synergie.optional(),
    queries: z
      .array(query)
      .min(1)
      .meta({ title: 'Ricerche', description: 'Le ricerche da eseguire, ciascuna con le sue parole chiave.' }),
  })
  .meta({ title: 'Ricerca', description: 'Dove, quanto indietro e con che ritmo cercare gli annunci.' });

const filter = z
  .strictObject({
    minScore: z.number().int().meta({
      title: 'Punteggio minimo',
      description: 'Gli annunci sotto questo punteggio vengono scartati.',
      unit: 'punti',
    }),
    minTitleScore: z.number().int().meta({
      title: 'Punteggio minimo del titolo',
      description: 'Gli annunci il cui titolo ha meno di questo punteggio vengono scartati.',
      unit: 'punti',
    }),
    nearMiss: z.number().int().min(0).default(3).meta({
      title: 'Appena sotto soglia',
      description: 'Gli annunci scartati per meno di questi punti restano 30 giorni in Statistiche; 0 non ne tiene.',
      unit: 'punti',
    }),
    maxYearsExperience: count.meta({
      title: 'Anni di esperienza massimi',
      description: "Oltre questi anni richiesti l'annuncio perde punti.",
      unit: 'anni',
    }),
    allowedLocations: words.default([]).meta({
      title: 'Luoghi ammessi',
      description: 'Città o zone accettate; se vuoto nessun luogo è accettato per nome.',
    }),
    allowedProvinces: z
      .array(z.string().regex(/^[A-Z]{2}$/u))
      .default([])
      .meta({ title: 'Province ammesse', description: 'Sigle delle province accettate, per esempio TO.' }),
    keepRemote: z
      .boolean()
      .default(true)
      .meta({ title: 'Tieni il remoto', description: 'Accetta gli annunci in remoto anche fuori dai luoghi ammessi.' }),
    keepGenericItaly: z.boolean().default(true).meta({
      title: 'Tieni "Italia"',
      description: "Accetta gli annunci con solo l'Italia come luogo o senza luogo.",
    }),
    blockedCompanies: words
      .default([])
      .meta({ title: 'Aziende escluse', description: 'Aziende i cui annunci vengono sempre scartati.' }),
    // How the posting's country is written: whole words that mean "in Italy" for the location filter.
    countryNames: words
      .default(['italia', 'italy'])
      .meta({ title: "Nomi dell'Italia", description: "Parole che indicano l'Italia come luogo di un annuncio." }),
    // Portals keep postings open for years (UniCredit lists 2022 ones); older than this is dropped. Undated always passes.
    maxAgeDays: count.default(365).meta({
      title: 'Età massima',
      description: 'Gli annunci pubblicati prima di questo limite vengono scartati; senza data passano.',
      unit: 'giorni',
    }),
  })
  .meta({ title: 'Filtri', description: 'Cosa tenere e cosa scartare tra gli annunci trovati.' });

const weights = z
  .strictObject({
    title: weightMap.meta({
      title: 'Parole nel titolo',
      description: 'Punti aggiunti o tolti quando la parola compare nel titolo.',
    }),
    description: weightMap.default({}).meta({
      title: 'Parole nella descrizione',
      description: 'Punti aggiunti o tolti quando la parola compare nella descrizione.',
    }),
    location: weightMap
      .default({})
      .meta({ title: 'Parole nel luogo', description: 'Punti aggiunti o tolti quando la parola compare nel luogo.' }),
    workMode: z
      .strictObject({
        remote: z
          .number()
          .int()
          .default(0)
          .meta({ title: 'Remoto', description: 'Punti per gli annunci in remoto.', unit: 'punti' }),
        hybrid: z
          .number()
          .int()
          .default(0)
          .meta({ title: 'Ibrido', description: 'Punti per gli annunci ibridi.', unit: 'punti' }),
        onsite: z
          .number()
          .int()
          .default(0)
          .meta({ title: 'In sede', description: 'Punti per gli annunci in sede.', unit: 'punti' }),
      })
      .default({ remote: 0, hybrid: 0, onsite: 0 })
      .meta({ title: 'Modalità di lavoro', description: 'Punti in base a dove si lavora.' }),
  })
  .meta({ title: 'Punteggi', description: 'Quanti punti dà ogni parola o modalità, per ordinare gli annunci.' });

/** The language patterns live in code (`years.ts`, `work-mode.ts`); the profile can only add phrases to them. */
const patterns = z
  .strictObject({
    years: z
      .strictObject({
        companySentence: words.default([]).meta({
          title: "Frasi sull'azienda",
          description: "Frasi che parlano degli anni dell'azienda e non dell'esperienza richiesta.",
        }),
      })
      .default({ companySentence: [] })
      .meta({ title: 'Anni di esperienza', description: 'Aiuta a leggere gli anni richiesti nelle descrizioni.' }),
    workMode: z
      .strictObject({
        remote: words
          .default([])
          .meta({ title: 'Frasi per il remoto', description: 'Frasi che indicano un lavoro in remoto.' }),
        hybrid: words
          .default([])
          .meta({ title: "Frasi per l'ibrido", description: 'Frasi che indicano un lavoro ibrido.' }),
        onsite: words
          .default([])
          .meta({ title: 'Frasi per la sede', description: 'Frasi che indicano un lavoro in sede.' }),
      })
      .default({ remote: [], hybrid: [], onsite: [] })
      .meta({ title: 'Modalità di lavoro', description: 'Frasi che aiutano a riconoscere dove si lavora.' }),
  })
  .meta({ title: 'Frasi', description: 'Frasi da aggiungere a quelle già note per leggere gli annunci.' });

/**
 * Postings open to a diploma holder at stable employers (16n1). Without this section Lavoro behaves as before.
 * `titleWeights` only rank a Stabile posting, `extraLocations` only widen the places for it.
 */
const stable = z
  .strictObject({
    category: z
      .string()
      .min(1)
      .default('Stabile')
      .meta({ title: 'Nome categoria', description: 'Etichetta data agli annunci di questa sezione.' }),
    companies: words
      .default([])
      .meta({ title: 'Aziende stabili', description: 'Aziende i cui annunci contano come stabili.' }),
    sites: z
      .array(site)
      .default([])
      .meta({ title: 'Portali', description: 'Portali i cui annunci contano come stabili.' }),
    bonus: z.number().int().min(0).default(0).meta({
      title: 'Bonus azienda stabile',
      description: 'Punti aggiunti a Interesse quando un annuncio stabile supera i controlli.',
      unit: 'punti',
    }),
    titleWeights: weightMap
      .default({})
      .meta({ title: 'Parole nel titolo', description: 'Punti per ordinare gli annunci stabili in base al titolo.' }),
    extraLocations: words
      .default([])
      .meta({ title: 'Luoghi in più', description: 'Luoghi accettati solo per gli annunci stabili.' }),
    excludePhrases: words
      .default([])
      .meta({ title: 'Frasi escluse', description: 'Frasi che fanno scartare un annuncio stabile.' }),
    // inPA `categorie` values whose items are never read, for example "Avvisi di mobilità" (16n2 step 3).
    inpaSkipCategories: words
      .default([])
      .meta({ title: 'Categorie inPA ignorate', description: 'Categorie di inPA i cui annunci non vengono letti.' }),
  })
  .meta({
    title: 'Posti stabili',
    description: 'Annunci per chi ha un diploma, presso aziende stabili; senza questa sezione non si usa.',
  });

/** Written for the owner's field; keyword lists are matched as whole words, like the weights. */
export const defaultCategories: Record<string, string[]> = {
  RAG: ['rag', 'retrieval', 'embedding', 'vector database', 'pgvector', 'langchain', 'llamaindex'],
  'AI / LLM': [
    'llm',
    'genai',
    'generative ai',
    'ai engineer',
    'machine learning',
    'openai',
    'prompt engineering',
    'nlp',
  ],
  Frontend: ['frontend', 'front-end', 'front end', 'react', 'svelte', 'sveltekit', 'vue', 'angular'],
  Backend: ['backend', 'back-end', 'back end', 'node.js', 'nodejs', 'fastify', 'rest api', 'microservices'],
  Mobile: ['mobile', 'react native', 'ios', 'android', 'flutter', 'kotlin'],
  'Cloud / DevOps': ['devops', 'docker', 'kubernetes', 'aws', 'azure', 'terraform', 'ci/cd'],
  Data: ['data engineer', 'data analyst', 'data scientist', 'sql', 'etl', 'power bi', 'tableau', 'bigquery'],
};

// Access to the sources themselves. Indeed's mobile API needs the app's key and identity, which only the local config
// holds; the country values are config too, so another country is a config change.
const indeedSource = z
  .strictObject({
    apiKey: z.string().min(1).meta({ secret: true, title: 'Chiave', description: "Chiave dell'app mobile di Indeed." }),
    userAgent: z.string().min(1).meta({ title: 'User agent', description: 'Identità del client inviata a Indeed.' }),
    appInfo: z.string().min(1).meta({ title: 'Info app', description: "Identità dell'app inviata a Indeed." }),
    domain: z
      .string()
      .min(1)
      .default('it.indeed.com')
      .meta({ title: 'Dominio', description: 'Sito di Indeed da usare, in base al paese.' }),
    country: z.string().min(1).default('IT').meta({ title: 'Paese', description: 'Codice del paese per Indeed.' }),
    locale: z
      .string()
      .min(1)
      .default('it-IT')
      .meta({ title: 'Lingua', description: 'Lingua e paese per Indeed, per esempio it-IT.' }),
    // Indeed reads the first results within 50 miles of this place: a whole country spends them far away.
    location: z.string().min(1).optional().meta({
      title: 'Luogo per Indeed',
      description:
        'Città intorno a cui cerca Indeed (raggio 80 km); se vuoto usa il luogo generale. Una ricerca con il suo luogo vince.',
    }),
  })
  .meta({ title: 'Indeed', description: "Accesso all'app mobile di Indeed." });

const sourceAccess = z
  .strictObject({ indeed: indeedSource.optional() })
  .meta({ title: 'Accesso ai portali', description: 'Dati per entrare nei portali che li richiedono.' });

const parere = z.strictObject({
  provider: z
    .enum(providers)
    .default('gemini')
    .meta({
      title: 'Fornitore',
      description: 'Gemini in rete oppure un modello locale servito da Ollama sul PC.',
      optionLabels: { gemini: 'Gemini', ollama: 'Ollama (locale)' },
    }),
  key: z.string().optional().meta({
    secret: true,
    title: 'Chiave Gemini',
    description: 'Solo per Gemini. Nel piano gratuito Google può usare i contenuti e farli leggere a revisori umani.',
  }),
  model: z.string().min(1).default('gemini-3.5-flash-lite').meta({
    title: 'Modello',
    description: 'Il modello che scrive il parere, per esempio gemini-3.5-flash-lite o gemma4:12b-it-qat.',
  }),
  dailyCap: z
    .number()
    .int()
    .positive()
    .default(30)
    .meta({ title: 'Limite giornaliero', description: 'Quanti pareri si possono chiedere al giorno.', unit: 'pareri' }),
  auto: z
    .boolean()
    .default(false)
    .meta({ title: 'Parere automatico', description: 'Chiede il parere da solo per ogni annuncio nuovo.' }),
  perMinute: z.number().int().positive().default(15).meta({
    title: 'Richieste al minuto',
    description: 'Solo per Gemini: quante richieste al massimo ogni minuto. Un modello locale non ha limite.',
    unit: 'richieste',
  }),
  manualReserve: z.number().int().nonnegative().default(5).meta({
    title: 'Riserva manuale',
    description: 'Quanti pareri del giorno restano per le richieste fatte a mano.',
    unit: 'pareri',
  }),
  profile: z
    .string()
    .default('')
    .meta({ title: 'Profilo', multiline: true, description: 'Non inserire dati di contatto.' }),
});

// Mail read by a local model (step 51). Only Ollama is ever used for it: mail text never leaves the PC.
const mailCheck = z.strictObject({
  accounts: z.array(z.string().min(1).max(60)).max(10).default([]).meta({
    title: 'Account letti',
    description: 'Gli account himalaya che il modello locale legge; senza account il controllo resta spento.',
  }),
  model: z.string().min(1).default('gemma4:12b-it-qat').meta({
    title: 'Modello locale',
    description: 'Il modello Ollama che legge la posta, per esempio gemma4:12b-it-qat.',
  }),
  windowDays: z.number().int().min(1).max(3650).default(14).meta({
    title: 'Giorni da leggere',
    description: 'Quanto indietro nel tempo cerca mail non ancora controllate.',
    unit: 'giorni',
  }),
  maxPerRun: z.number().int().min(1).max(200).default(20).meta({
    title: 'Mail per controllo',
    description: 'Quante mail nuove legge al massimo in un controllo; le altre restano per il successivo.',
    unit: 'mail',
  }),
  todoDays: z.number().int().min(1).max(3650).default(7).meta({
    title: 'Giorni di Da fare',
    description: 'Da quanti giorni indietro le mail che chiedono qualcosa compaiono in Oggi.',
    unit: 'giorni',
  }),
  auto: z.boolean().default(false).meta({
    title: 'Controllo automatico',
    description: "Controlla da solo la posta nuova ogni mezz'ora mentre Hub è acceso.",
  }),
});

// Step 78: the terminal that "Prepara candidatura" opens; `{folder}` is replaced by the CV folder of the skill's paths file.
export const defaultTerminal = ['foot', '--working-directory={folder}'];
const candidatura = z.strictObject({
  terminal: z.array(z.string().min(1)).min(1).default(defaultTerminal).meta({
    manual: true,
    title: 'Terminale',
    description:
      'Comando e opzioni che aprono un terminale; Hub aggiunge claude e la skill. {folder} è la cartella dei CV. Vuoto: foot.',
  }),
});

export const dedupeSchema = z.strictObject({
  companyAliases: z.record(z.string().min(1), z.string().min(1)).default({}),
  descriptionSimilarity: z.number().min(0.5).max(1).default(0.78),
  minDescriptionChars: z.number().int().positive().default(200),
});

export const profileSchema = z
  .strictObject({
    search,
    sources: sourceAccess.default({}),
    dedupe: dedupeSchema.default(dedupeSchema.parse({})),
    filter,
    weights,
    categories: z
      .record(z.string().min(1), words)
      .default(defaultCategories)
      .meta({ title: 'Categorie', description: 'Ogni categoria con le parole che la riconoscono in un annuncio.' }),
    patterns: patterns.default(patterns.parse({})),
    stable: stable.optional(),
    waitingDays: z.number().int().positive().default(7).meta({
      title: 'Giorni di attesa',
      description: 'Dopo quanti giorni senza risposta una candidatura risulta in attesa.',
      unit: 'giorni',
    }),
    parere: parere.default({
      provider: 'gemini',
      key: undefined,
      model: 'gemini-3.5-flash-lite',
      dailyCap: 30,
      auto: false,
      perMinute: 15,
      manualReserve: 5,
      profile: '',
    }),
    candidatura: candidatura.default({ terminal: defaultTerminal }),
    mailCheck: mailCheck.default({
      accounts: [],
      model: 'gemma4:12b-it-qat',
      windowDays: 14,
      maxPerRun: 20,
      todoDays: 7,
      auto: false,
    }),
  })
  .superRefine((profile, ctx) => {
    const enabled = new Set([...profile.search.sites, ...profile.search.queries.flatMap((query) => query.sites ?? [])]);
    if (enabled.has('indeed') && !profile.sources.indeed) {
      ctx.addIssue({ code: 'custom', path: ['sources', 'indeed'], message: 'required when indeed is enabled' });
    }
    for (const site of [
      'inpa',
      'iren',
      'successfactors',
      'oracle',
      'avature',
      'manpower',
      'workday',
      'synergie',
    ] as const) {
      if (enabled.has(site) && !profile.search[site]) {
        ctx.addIssue({ code: 'custom', path: ['search', site], message: `required when ${site} is enabled` });
      }
    }
  });

export type Profile = z.output<typeof profileSchema>;

/** Gemini's free tier counts requests per minute; a local Ollama model has no such limit, so it is never spaced. */
export const parereIntervalMs = (parere: Pick<Profile['parere'], 'provider' | 'perMinute'>) =>
  parere.provider === 'ollama' ? 0 : Math.ceil(60_000 / parere.perMinute);
export type Filter = Profile['filter'];
export type Weights = Profile['weights'];
export type StableConfig = z.output<typeof stable>;
