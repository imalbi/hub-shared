import { setTimeout as wait } from 'node:timers/promises';
import { z, ollamaChat, OllamaError } from '../../apps/server/src/core/module.ts';
export { ollamaUrl } from '../../apps/server/src/core/module.ts';
import { extractSalary } from './salary.ts';

export const reasonCodes = [
  'location',
  'work_mode',
  'salary',
  'domain',
  'seniority',
  'degree',
  'sales',
  'contract',
  'language',
  'other',
] as const;

export const possibilities = ['alta', 'media', 'bassa', 'fuori'] as const;
export type Possibility = (typeof possibilities)[number];
// Verdicts stored before prompt version 7; read only, through possibilityOf.
const legacyVerdicts = ['candidati', 'chiedi prima', 'scarta'] as const;
const constraintCodes: readonly string[] = ['location', 'work_mode', 'salary', 'sales', 'contract'];

export const opinionSchema = z.strictObject({
  codes: z
    .array(z.enum(reasonCodes))
    .max(3)
    .refine((codes) => new Set(codes).size === codes.length)
    .default([]),
  verdict: z.enum(possibilities),
  why: z.string().min(1),
  fit: z.array(z.string().min(1)).max(4),
  contro: z.array(z.string().min(1)).max(5),
  next: z.string().min(1),
  unverified: z.array(z.string().min(1)),
});
export type Opinion = z.output<typeof opinionSchema>;
/** What the database may hold: a new answer or one from before version 7. */
export const storedOpinionSchema = opinionSchema.extend({ verdict: z.enum([...possibilities, ...legacyVerdicts]) });
export type StoredOpinion = z.output<typeof storedOpinionSchema>;

/** The one reader of a verdict: an old answer maps to a Possibilità, a new one passes through. No stored row is rewritten. */
export function possibilityOf(opinion: Pick<StoredOpinion, 'verdict' | 'codes'>): Possibility {
  switch (opinion.verdict) {
    case 'candidati':
      return 'alta';
    case 'chiedi prima':
      return 'media';
    case 'scarta':
      return opinion.codes.some((code) => constraintCodes.includes(code)) ? 'fuori' : 'bassa';
    default:
      return opinion.verdict;
  }
}
export const overloaded = 'Gemini è sovraccarico, riprova tra qualche minuto';
export const promptVersion = 10;

export type OpinionPosting = {
  title: string;
  company: string;
  location: string;
  workMode: string | null;
  description: string | null;
  reasons: string[];
  bando?: string;
};

export function opinionInput(profile: string, posting: OpinionPosting, model: string) {
  return {
    version: promptVersion,
    profile,
    model,
    posting: { ...posting, salary: extractSalary(posting.description) },
  };
}

const text = (description: string) => ({ type: 'string', minLength: 1, description });
const list = (description: string, maxItems?: number) => ({
  type: 'array',
  items: { type: 'string', minLength: 1 },
  description,
  ...(maxItems ? { maxItems } : {}),
});
const schema = {
  type: 'object',
  properties: {
    codes: { type: 'array', items: { type: 'string', enum: reasonCodes }, maxItems: 3 },
    verdict: { type: 'string', enum: possibilities },
    why: text('Una frase sul perché della Possibilità o del vincolo violato.'),
    fit: list('Punti a favore, al massimo 4.', 4),
    contro: list('Punti contro, al massimo 5.', 5),
    next: text(
      "Una sola azione concreta che il proprietario fa da solo in meno di due minuti, sempre presente anche se il verdetto è fuori. Mai scrivere all'azienda.",
    ),
    unverified: list('Cosa non hai potuto verificare.'),
  },
  required: ['codes', 'verdict', 'why', 'fit', 'contro', 'next', 'unverified'],
};

// Ollama constrains the shape with the schema but never shows the model its descriptions: without this text a local
// model filled fit and contro with reason codes (prompt version 6, kept in 7).
const answerFields = `Campi della risposta JSON:
- codes: fino a tre codici tra quelli elencati sopra; sono l'unico posto dove vanno i codici.
- verdict: alta, media, bassa oppure fuori.
- why: una frase sul perché del verdetto.
- fit: fino a 4 frasi brevi in italiano, ciascuna un fatto dell'annuncio che corrisponde al profilo (per esempio "Full remote dall'Italia, compatibile con il vincolo di sede"). Mai un codice.
- contro: fino a 5 frasi brevi in italiano, ciascuna un fatto dell'annuncio che va contro il profilo, con il dato concreto (anni richiesti, sede, cifra). Un dato che manca non è un contro: va in unverified. Un requisito solo preferenziale va scritto come preferenziale. Mai un codice.
- next: una sola azione concreta che il proprietario fa da solo in meno di due minuti (leggere il bando, guardare il sito dell'azienda, preparare la candidatura). Mai scrivere o telefonare all'azienda per chiedere requisiti o idoneità.
- unverified: i dati che servono e l'annuncio non dice.`;

export const providers = ['gemini', 'ollama'] as const;
export type Provider = (typeof providers)[number];
// shortcut: Ollama's default loopback address; add a config field if it ever runs on another host.

export async function fetchOpinion(
  fetcher: typeof fetch,
  key: string,
  input: ReturnType<typeof opinionInput>,
  signal: AbortSignal,
  retryDelayMs = 2000,
  provider: Provider = 'gemini',
  now = new Date(),
) {
  // Models reason from their training cutoff: without today's date a job that ended last summer reads as future.
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const prompt = `Oggi è il ${today}: le date del profilo e dell'offerta fino a oggi sono passate. Valuta l'offerta in italiano.

Prima confronta i vincoli inderogabili del profilo con fatti espliciti dell'offerta. Usa "fuori" solo quando un fatto dichiarato viola un vincolo, spiegando quale. Se un dato manca o è ambiguo, scrivilo in unverified: non è una violazione e non abbassa mai la Possibilità. Le preferenze non sono vincoli e non abbassano la probabilità di richiamo: se la presenza è accettata non metterla nei contro. Una sede tra più sedi possibili non significa presenza obbligatoria in tutte; se la sede effettiva non è chiara, è da verificare. Non presumere che il remoto sia obbligatorio se il profilo accetta anche sedi raggiungibili. Le ragioni con "(sede)" o "(modalità)" e un numero positivo dicono che sede e modalità sono già compatibili con il profilo: non vanno nei contro né in codes.

Poi valuta la Possibilità come stima qualitativa, non certezza di ricevere una risposta. "alta": requisiti centrali soddisfatti e nessuna lacuna significativa; "media": corrispondenza significativa con lacune o dubbi; "bassa": divario sostanziale nei requisiti centrali. Valuta insieme esperienza, competenze, autonomia e requisiti: pochi anni rispetto a quelli richiesti sono uno svantaggio, ma non portano automaticamente a "bassa". Se l'esperienza in un dominio specialistico è centrale e manca, considerala un divario reale. Non confondere un settore citato nella presentazione dell'azienda con il dominio richiesto dal ruolo. Le competenze trasversali non compensano un dominio specialistico mancante. Sii prudente: "alta" solo se nessun vincolo è violato, i requisiti centrali sono già nel profilo e gli anni richiesti non superano di molto quelli del profilo; nel dubbio scegli "media", mai "alta".
Applica esattamente uno di questi due casi mutuamente esclusivi:
- Caso A (concorsi pubblici, apprendistato, tirocini/stage, ruoli operativi, tecnici, elettrotecnici, IT/sistemistici o amministrativi entry-level che chiedono solo il diploma o non richiedono esperienza professionale specifica obbligatoria nel ruolo): NON applicare il controllo sull'esperienza lavorativa pregressa nel dominio. Se il diploma del profilo (titolo di studio dichiarato nel profilo e richiesto dall'offerta), i vincoli formali (sede, patente B, disponibilità a turni, età per apprendistato) e le competenze di base soddisfano quanto richiesto, assegna "alta" (oppure "media" se manca un requisito preferenziale rilevante o c'è un dubbio reale).
- Caso B (ruoli ingegneristici o specialistici in uno stack o dominio tecnico specifico, anche se aperti a neolaureati): applica in ordine queste regole pratiche: 1) se il linguaggio, la piattaforma o il dominio tecnico al centro del ruolo (quello del titolo o del primo requisito: per esempio C++, C#/.NET, Java, embedded, RTOS, automotive, SAP, PLC) non è nell'esperienza professionale del profilo, è "bassa", anche se il profilo ha competenze affini o universitarie (in particolare se manca anche la laurea richiesta); 2) se lo stack centrale del ruolo coincide con quello usato nel lavoro del profilo e l'offerta chiede al massimo due anni o è junior, è "alta", anche se manca qualche requisito secondario; 3) se l'offerta chiede più del doppio degli anni di esperienza professionale del profilo, è "bassa"; 4) altrimenti "media".
Un requisito che l'offerta elenca tra quelli richiesti non è preferenziale.

Distingui obbligatorio, indicativo, alternativa equivalente e preferenziale: non trasformare un'alternativa o un plus in obbligo. Se è richiesto Java o Python e il profilo conosce Python, non scrivere che manca Java. Se non è richiesta una certificazione linguistica, non indicarne l'assenza come problema. Se gli anni sono indicativi o è accettata competenza equivalente, riportalo insieme al numero di anni. Confronta ogni competenza con l'intero profilo: non dire che manca se è dichiarata, ma distingui conoscenza da esperienza professionale. Non attribuire competenze, certificazioni o esperienze non dichiarate. Riporta le cifre e le condizioni senza inventarle. Individua etichette contraddette dal testo, come remoto non realmente remoto o junior con cinque anni di esperienza. Non inventare fatti sull'azienda.

Indica in codes fino a tre ragioni principali contro l'offerta, senza duplicati e in ordine di importanza, oppure un array vuoto: location sede, work_mode modalità, salary retribuzione, domain dominio, seniority esperienza, degree laurea, sales commerciale, contract contratto, language lingua, other altro. Indica un solo prossimo passo che il proprietario fa da solo in meno di due minuti, senza mai suggerire di contattare l'azienda.\n${answerFields}\nProfilo: ${input.profile}\nOfferta: ${JSON.stringify(input.posting)}\nIl campo bando, se presente, contiene il testo ufficiale del bando e può essere troncato. Le ragioni sono punteggi automatici del modulo e possono essere sbagliate.`;
  const text =
    provider === 'ollama'
      ? await ollamaText(fetcher, prompt, input.model, signal)
      : await geminiText(fetcher, key, prompt, input.model, signal, retryDelayMs);
  if (!text) throw new Error('invalid response');
  // The answer may quote the profile on purpose (a constraint it breaks): it is loopback only, read by the owner.
  return dropSettledCodes(opinionSchema.parse(JSON.parse(text)), input.posting.reasons);
}

// A local model kept listing the office as a reason against even when the score had already found it compatible
// (prompt version 8 trial, 2026-11-17): a positive score for the place or the mode settles it.
export function dropSettledCodes(opinion: Opinion, reasons: string[]): Opinion {
  if (opinion.verdict === 'fuori') return opinion;
  const settled = (label: string) => reasons.some((reason) => new RegExp(`:\\+\\d+ \\(${label}\\)$`, 'u').test(reason));
  const drop = new Set([...(settled('sede') ? ['location'] : []), ...(settled('modalità') ? ['work_mode'] : [])]);
  return { ...opinion, codes: opinion.codes.filter((code) => !drop.has(code)) };
}

/** The one Ollama call: the Parere uses its own schema and context, the mail check passes theirs. */
export async function ollamaText(
  fetcher: typeof fetch,
  prompt: string,
  model: string,
  signal: AbortSignal,
  format: object = schema,
  // 16k tokens fit the longest bando (20k characters) plus profile; Ollama's default context would cut it.
  numCtx = 16384,
) {
  try {
    return (
      await ollamaChat(fetcher, {
        model,
        format,
        messages: [{ role: 'user', content: prompt }],
        numCtx,
        temperature: 0.2,
        signal,
      })
    ).text;
  } catch (error) {
    if (error instanceof OllamaError && error.status !== undefined) throw new OpinionProviderError(error.status);
    throw error;
  }
}

async function geminiText(
  fetcher: typeof fetch,
  key: string,
  prompt: string,
  model: string,
  signal: AbortSignal,
  retryDelayMs: number,
) {
  const request = () =>
    fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } } },
      }),
    });
  let response = await request();
  // The free tier answers 503 when the model is overloaded; two spaced retries usually get through.
  for (let attempt = 1; attempt <= 2 && response.status === 503; attempt++) {
    await wait(retryDelayMs * attempt, undefined, { signal });
    response = await request();
  }
  if (!response.ok) throw new OpinionProviderError(response.status, await providerDetail(response));
  const envelope = z
    .object({
      candidates: z
        .array(
          z.object({
            content: z.object({
              parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })),
            }),
          }),
        )
        .min(1),
    })
    .parse(await response.json());
  // A thinking model can return thought parts or a part with only a signature before the answer text.
  return envelope.candidates[0]?.content.parts
    .filter((part) => !part.thought)
    .map((part) => part.text ?? '')
    .join('');
}

export class OpinionProviderError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail = '') {
    super('provider error');
    this.status = status;
    this.detail = detail;
  }
}

const safeToken = /^[\w.[\]-]{1,120}$/u;
const providerError = z.object({
  error: z.object({
    status: z.string().optional(),
    details: z
      .array(z.object({ fieldViolations: z.array(z.object({ field: z.string() })).optional() }).loose())
      .optional(),
  }),
});

/** Google's error code and the request fields it rejected: identifiers only, never its free-text message. */
async function providerDetail(response: Response) {
  const parsed = providerError.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return '';
  const fields = (parsed.data.error.details ?? []).flatMap((d) => d.fieldViolations ?? []).map((v) => v.field);
  return [parsed.data.error.status, ...fields].filter((t): t is string => !!t && safeToken.test(t)).join(' ');
}

/** One log-safe line for a failed Parere: codes and field paths, never the key, the profile or the posting. */
export function opinionFailure(error: unknown) {
  if (error instanceof OpinionProviderError) return `http ${error.status} ${error.detail}`.trim();
  if (error instanceof z.ZodError)
    return `invalid answer at ${error.issues.map((i) => `${i.path.join('.') || '(root)'} (${i.code})`).join(', ')}`;
  if (error instanceof SyntaxError) return 'answer is not JSON';
  return error instanceof Error ? error.name : 'unknown';
}
