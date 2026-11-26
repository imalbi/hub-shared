import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { createLiveHub } from '../../apps/server/src/core/live.ts';
import { defineModule, pinnedRequest, TRPCError, z, type MailThreadEntry } from '../../apps/server/src/core/module.ts';
import { and, desc, eq, inArray, isNull, sql } from '../../apps/server/src/core/module-db.ts';
import { agentOrLoopbackProcedure, loopbackProcedure, router } from '../../apps/server/src/core/trpc.ts';
import type { Db } from '../../apps/server/src/db/index.ts';
import { llmGate, LlmGateError } from '../../apps/server/src/core/llm-gate.ts';
import { blacklistFields, blacklistMatchTypes } from './blacklist.ts';
import { readBando } from './bando.ts';
import { effectiveApplicationStatus, isActive } from './applications.ts';
import { cleanHtml } from './clean-html.ts';
import { runCollection, type CollectionKind, type CollectionStatus, type Progress } from './collect.ts';
import { defaultTerminal, parereIntervalMs, profileSchema, type Profile } from './config.ts';
import { assertPublicTarget, fetchAndParsePosting } from './import-read.ts';
import { createIndeedSource } from './indeed.ts';
import { createInpaSource } from './inpa.ts';
import { createIrenSource } from './iren.ts';
import { createSuccessFactorsSource } from './successfactors.ts';
import { createOracleSource } from './oracle.ts';
import { createAvatureSource } from './avature.ts';
import { createManpowerSource } from './manpower.ts';
import { createSynergieSource } from './synergie.ts';
import { createWorkdaySource } from './workday.ts';
import { createLinkedinSource } from './linkedin.ts';
import { createReteInformaticaSource } from './rete-informatica.ts';
import type { DryRunRow } from './ingest.ts';
import { comparisonKey, postingKey } from './key.ts';
import { postingUrl } from './posting-url.ts';
import { parseMarkdown } from './markdown.ts';
import { plain } from './key.ts';
import {
  fetchOpinion,
  opinionFailure,
  overloaded,
  opinionInput,
  possibilityOf,
  storedOpinionSchema,
  OpinionProviderError,
  type Possibility,
  type StoredOpinion,
} from './opinion-prompt.ts';
import { pointsMissing, suggestWords, type WordSuggestion } from './near-miss.ts';
import { createScorer } from './score.ts';
import { mailAnswerSchema, type MailAnswer } from './mail-prompt.ts';
import { firstResponse } from './stats.ts';
import { selectTodos, todoDeadlines } from './mail-todos.ts';
import {
  companyEvidence,
  interviewTimestamp,
  proposeFollowUps,
  runMailCheck,
  saveThreadAddresses,
  windowStart,
  type MailCheckState,
} from './mail-check.ts';
import { sameCompanyApplications, type CompanyApplication } from './same-company.ts';
import { searchApplications, searchPostings } from './records.ts';
import { sortJobs } from './sort.ts';
import { summarizeLavoro } from './widget-summary.ts';
import { tabOf } from './tabs.ts';
import { createWorkModeResolver } from './work-mode.ts';
import {
  applicationStatuses,
  applicationAddress,
  bandoTexts,
  blacklistRules,
  collections,
  jobApplied,
  jobArchive,
  jobDeleted,
  jobInterview,
  jobMailLink,
  mailChecked,
  mailProposals,
  jobs,
  nearMisses,
  opinions,
  purgedJobs,
  type ApplicationStatus,
} from './schema.ts';
import { MAX_SCRAPER_BYTES } from './bounded-fetch.ts';
import { defaultClock, type Clock, type Source } from './source.ts';

function postingAddresses(text: string | null) {
  return [
    ...new Set((text?.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((address) => address.toLowerCase())),
  ].filter((address) => z.email().safeParse(address).success);
}

export type NearMissView = {
  key: string;
  url: string;
  title: string;
  company: string;
  site: string;
  score: number;
  /** Points still needed at the time it was refused: the larger deficit of the two score gates. */
  missing: number;
  reasons: string[];
  lastSeen: number;
};
export type NearMissesState = { rows: NearMissView[]; words: WordSuggestion[] };

export type InterviewRow = {
  id: number;
  key: string;
  scheduledAt: number;
  label?: string;
};

export type ApplicationRow = {
  appliedAt: number;
  status: ApplicationStatus;
  closedAt: number | null;
  reason: string | null;
  notes: string | null;
  interviews?: InterviewRow[];
  /** The newest linked mail (received date, else link date) and the kind the mail check read in it, if it did. */
  lastMail?: { at: number; kind: MailAnswer['kind'] | null } | null;
};

export const importedRowSchema = z
  .object({
    company: z.string().min(1),
    role: z.string().min(1),
    channel: z.enum(['sito', 'linkedin', 'indeed', 'agenzia']),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(['no_response', 'expired', 'rejected', 'colloquio']),
    closed: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    notes: z.string().optional(),
    url: z.string().min(1).optional(),
    job_id: z.string().optional(),
    interviews: z
      .array(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          time: z
            .string()
            .regex(/^\d{2}:\d{2}$/)
            .optional(),
          type: z.string().min(1),
        }),
      )
      .optional(),
    remote: z.boolean().optional(),
    date_estimated: z.boolean().optional(),
  })
  .loose();

const searchInput = z.object({ query: z.string().trim().min(1).max(100) });

export type JobRow = {
  key: string;
  comparisonKey: string;
  title: string;
  company: string;
  location: string;
  site: string;
  url: string;
  applyUrl: string | null;
  score: number;
  total: number;
  reasons: string[];
  categories: string[];
  description: string | null;
  descriptionHtml: string | null;
  workMode: 'remote' | 'hybrid' | 'onsite' | null;
  isRemote: boolean;
  detailsMissing: boolean;
  postedAt: number | null;
  firstSeen: number;
  importedAt: number | null;
  blacklistRule: number | null;
  archivedAt: number | null;
  deletedAt: number | null;
  application: ApplicationRow | null;
  companyApplications: CompanyApplication[];
  opinion: {
    verdict: StoredOpinion['verdict'];
    possibility: Possibility;
    codes: StoredOpinion['codes'];
    unverified: string[];
    outdated: boolean;
  } | null;
};

export type RuleRow = {
  id: number;
  enabled: boolean;
  field: (typeof blacklistFields)[number];
  matchType: (typeof blacklistMatchTypes)[number];
  value: string;
  note: string;
  createdAt: number;
};

export type LavoroState =
  | {
      status: 'ready';
      queries: number;
      sources: string[];
      descriptionSources: string[];
      /** The collection running now, with its progress. */
      collection: Progress | null;
      /** The last one that finished, a dry run included. */
      last: {
        kind: CollectionKind;
        finishedAt: number;
        status: CollectionStatus;
        newCount: number;
        excludedCount: number;
      } | null;
      /** What the last dry run would have listed (top 100); gone when a collection starts or the server restarts. */
      dryRun: DryRunRow[] | null;
      /** Stabile postings the last dry run dropped for what they require, by reason; the same lifetime as `dryRun`. */
      dryRunRequirements: Record<string, number> | null;
      pareri: PareriState | null;
      /** The local-model mail check: null until the first run since the server started. */
      mailCheck: MailCheckState | null;
    }
  | { status: 'invalid-config'; issues: Array<{ path: string; message: string }> };

type PareriState = { running: boolean; done: number; remaining: number; reason: string | null; date: number };

/** A local model needs no key; every provider needs the profile. */
function missingSetup(parere: Profile['parere']) {
  return (parere.provider === 'gemini' && !parere.key) || !parere.profile.trim();
}

/**
 * `sources` is the registry of sources; tests pass fakes and a virtual clock. Discovery loads the default export, built
 * with the real clock and the real sources (Rete Informatica Lavoro and LinkedIn join it in 16e and 16f).
 */
/** Null for an old verdict without codes (unknown, not "no reasons") and for one that no longer parses, so neither blocks a purge. */
function codesToKeep(verdict: unknown) {
  const parsed = storedOpinionSchema.safeParse(verdict);
  if (!parsed.success || typeof verdict !== 'object' || verdict === null || !('codes' in verdict)) return null;
  return JSON.stringify(parsed.data.codes);
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Adds an interview; the first one moves a pending application to interviewing. Shared by the action and by a confirmed proposal. */
function scheduleInterview(tx: Tx, input: { key: string; scheduledAt: number; label: string }) {
  const job = tx.select().from(jobs).where(eq(jobs.key, input.key)).get();
  if (!job) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Job posting not found' });
  }
  const app = tx.select().from(jobApplied).where(eq(jobApplied.key, input.key)).get();
  if (!app) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Posting has no application' });
  }
  const existing = tx.select({ id: jobInterview.id }).from(jobInterview).where(eq(jobInterview.key, input.key)).all();

  if (existing.length === 0 && app.status === 'pending') {
    tx.update(jobApplied).set({ status: 'interviewing' }).where(eq(jobApplied.key, input.key)).run();
  }

  const inserted = tx
    .insert(jobInterview)
    .values({ key: input.key, scheduledAt: new Date(input.scheduledAt), label: input.label.trim() })
    .returning({ id: jobInterview.id })
    .get();

  return { id: inserted.id };
}

const missingPaths =
  'Copia `skills/paths.example.json` in `skills/paths.local.json` e metti nel campo `folder` la cartella con i tuoi CV (.tex) e dove scrivere le candidature.';
const missingCandidaturaSkill = 'La skill `candidatura/SKILL.md` non esiste.';

export function postingId(key: string) {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

const CLAUDE_DISALLOWED_TOOLS = [
  'mcp__hub__settings_save',
  'mcp__hub__settings_saveCore',
  'mcp__hub__settings_restore',
  'mcp__hub__lavoro_importSave',
  'mcp__hub__lavoro_edit',
  'mcp__hub__lavoro_setApplication',
  'mcp__hub__lavoro_deleteApplication',
  'mcp__hub__lavoro_importApplications',
  'mcp__hub__lavoro_setFlag',
  'mcp__hub__lavoro_purge',
  'mcp__hub__lavoro_addNearMiss',
  'mcp__hub__lavoro_raccogli',
  'mcp__hub__lavoro_prova',
  'mcp__hub__lavoro_annulla',
  'mcp__hub__lavoro_requestOpinion',
  'mcp__hub__lavoro_pareriMancanti',
  'mcp__hub__lavoro_rules_create',
  'mcp__hub__lavoro_rules_update',
  'mcp__hub__lavoro_rules_delete',
  'mcp__hub__lavoro_rules_setEnabled',
  'mcp__hub__lavoro_rules_include',
  'mcp__hub__lavoro_links_add',
  'mcp__hub__lavoro_links_remove',
  'mcp__hub__lavoro_addInterview',
  'mcp__hub__lavoro_updateInterview',
  'mcp__hub__lavoro_deleteInterview',
  'mcp__hub__notes_add',
  'mcp__hub__notes_edit',
  'mcp__hub__notes_remove',
  'mcp__hub__notes_restore',
  'mcp__hub__agents_create',
  'mcp__hub__agents_revoke',
  'mcp__hub__devices_revoke',
  'mcp__hub__pairing_createCode',
  'mcp__hub__pairing_redeem',
  'mcp__hub__confirmations_confirm',
  'mcp__hub__confirmations_deny',
  'mcp__hub__backup_run',
  'mcp__hub__layout_save',
  'mcp__hub__layout_reset',
  'mcp__hub__theme_save',
  'mcp__hub__theme_rename',
  'mcp__hub__theme_delete',
  'mcp__hub__system_monitor_toggle',
  'mcp__hub__system_toggleWorkspace',
  'mcp__hub__system_lock',
  'mcp__hub__system_suspend',
  'mcp__hub__system_reboot',
  'mcp__hub__system_powerOff',
] as const;

export function candidaturaClientArgs(client: 'claude' | 'codex', prompt: string, hubMcpUrl: string): string[] {
  if (client === 'claude') {
    return [
      'claude',
      '--permission-mode',
      'default',
      '--strict-mcp-config',
      '--mcp-config',
      JSON.stringify({ mcpServers: { hub: { type: 'http', url: hubMcpUrl } } }),
      '--disallowedTools',
      CLAUDE_DISALLOWED_TOOLS.join(','),
      '--',
      prompt,
    ];
  }
  return [
    'codex',
    '--sandbox',
    'workspace-write',
    '--ask-for-approval',
    'on-request',
    '-c',
    `mcp_servers={hub={url=${JSON.stringify(hubMcpUrl)}}}`,
    '--',
    prompt,
  ];
}

function assertHttpUrl(raw: string, field: string): string {
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${field} must be a valid URL` });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${field} must use http or https` });
  }
  return trimmed;
}

function forbidAgent(ctx: { client: { kind: string } }) {
  if (ctx.client.kind === 'agent') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'An agent cannot perform this action' });
  }
}

async function candidaturaPrompt(client: 'claude' | 'codex', key: string, skillsDir: string) {
  const id = postingId(key);
  if (client === 'claude') return `/candidatura ${id}`;
  const skillFile = resolve(skillsDir, 'candidatura', 'SKILL.md');
  const skill = await stat(skillFile).catch(() => undefined);
  if (!skill?.isFile()) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: missingCandidaturaSkill });
  return `Leggi e segui le istruzioni nel file SKILL ${JSON.stringify(skillFile)}. Usa l'annuncio con id ${JSON.stringify(id)}.`;
}

/** The CV folder the `candidatura` skill reads from `skills/paths.local.json` (a leading `~` is the home). */
async function candidaturaFolder(skillsDir: string): Promise<string> {
  const refuse = (message: string) => new TRPCError({ code: 'PRECONDITION_FAILED', message });
  const text = await readFile(join(skillsDir, 'paths.local.json'), 'utf8').catch(() => null);
  const parsed = text === null ? undefined : z.object({ folder: z.string().min(1) }).safeParse(safeJson(text));
  if (!parsed?.success) throw refuse(missingPaths);
  const folder = parsed.data.folder.replace(/^~(?=\/|$)/, homedir());
  const found = await stat(folder).catch(() => null);
  if (!found?.isDirectory()) throw refuse('La cartella indicata in `skills/paths.local.json` non esiste.');
  return folder;
}

async function noteFile(skillsDir: string, kind: 'colloquio' | 'lacune', directory = '') {
  try {
    const root = await realpath(join(await candidaturaFolder(skillsDir), 'candidature'));
    const dir = await realpath(join(root, directory));
    const rel = relative(root, dir);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
    const pattern = new RegExp(`^${kind}-(\\d{4}-\\d{2}-\\d{2})(?:-(\\d+))?\\.md$`);
    const names = (await readdir(dir)).filter((name) => pattern.test(name));
    names.sort((a, b) => {
      const left = pattern.exec(a);
      const right = pattern.exec(b);
      return (right?.[1] ?? '').localeCompare(left?.[1] ?? '') || Number(right?.[2] ?? 1) - Number(left?.[2] ?? 1);
    });
    for (const file of names) {
      const path = await realpath(join(dir, file)).catch(() => null);
      if (!path) continue;
      const relativeFile = relative(root, path);
      if (!relativeFile || relativeFile === '..' || relativeFile.startsWith(`..${sep}`) || isAbsolute(relativeFile))
        continue;
      if (!(await stat(path)).isFile()) continue;
      const date = pattern.exec(file)?.[1];
      if (date) return { file, date, blocks: parseMarkdown(await readFile(path, 'utf8')), path };
    }
  } catch {
    return null;
  }
  return null;
}

function noteDirectory(company: string, title: string) {
  const slug = (value: string) => plain(value).replaceAll(' ', '-');
  return `${slug(company)}_${slug(title)}`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createLavoroModule({
  sources = [],
  clock = defaultClock,
  profile,
  lookup,
  fetch: customFetch,
  gate = llmGate,
  skillsDir = fileURLToPath(new URL('./skills/', import.meta.url)),
}: {
  sources?: readonly Source[];
  clock?: Clock;
  profile?: Profile;
  lookup?: (hostname: string) => Promise<string[]> | string[];
  fetch?: typeof fetch;
  gate?: typeof llmGate;
  /** Where `paths.local.json` lives; tests point it at a temporary folder. */
  skillsDir?: string;
} = {}) {
  return defineModule({
    name: 'lavoro',
    optional: {
      mail: 'Collega le email dei recruiter alle candidature e propone aggiornamenti automatici',
    },
    // Discovery skips a module whose config fails and says nothing useful, so the slice is accepted as-is here and
    // parsed strictly inside `create`: a bad profile leaves the module loaded and `state` names the offending keys.
    config: z.unknown(),
    // Impostazioni draws its form and checks a save with the strict profile; loading stays tolerant, as above.
    settingsSchema: profileSchema,
    migrations: fileURLToPath(new URL('./drizzle', import.meta.url)),
    create({ config, db, run, fetch, log, capabilities, trackJob }) {
      const mail = capabilities.get('mail');
      const parsedProfile = profile ? { success: true as const, data: profile } : profileSchema.safeParse(config);
      const registry = new Map(sources.map((source) => [source.name, source]));
      const cleaner = parseHTML('<!doctype html><html><body></body></html>').document;
      const effectiveFetch = customFetch ?? fetch;
      let active: { controller: AbortController; progress: Progress | null; done: Promise<void> } | undefined;
      let descriptionTurn = Promise.resolve();
      let descriptionNext = 0;
      let dryRun: DryRunRow[] | null = null;
      let dryRunRequirements: Record<string, number> | null = null;
      let pareri: PareriState | null = null;
      let pareriWork: { controller: AbortController; done: Promise<void> } | undefined;
      let mailState: MailCheckState | null = null;
      let mailWork: { controller: AbortController; done: Promise<void> } | undefined;
      let mailTimers: NodeJS.Timeout[] = [];

      async function readState(): Promise<LavoroState> {
        // Paths and zod's messages name the query by index and the key; they never carry the values written.
        if (!parsedProfile.success)
          return {
            status: 'invalid-config',
            issues: parsedProfile.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          };
        const last = db.select().from(collections).orderBy(desc(collections.id)).limit(1).get();
        return {
          status: 'ready',
          queries: parsedProfile.data.search.queries.length,
          sources: parsedProfile.data.search.sites,
          descriptionSources: sources.filter((source) => source.describe).map((source) => source.name),
          collection: active?.progress ?? null,
          last: last
            ? {
                kind: last.kind,
                finishedAt: last.finishedAt.getTime(),
                status: last.status,
                newCount: last.newCount,
                excludedCount: last.excludedCount,
              }
            : null,
          dryRun,
          dryRunRequirements,
          pareri,
          mailCheck: mailState,
        };
      }
      const live = createLiveHub(readState, null);

      function inputFor(job: typeof jobs.$inferSelect, bando: typeof bandoTexts.$inferSelect | null | undefined) {
        const profile = ready();
        const input = opinionInput(
          profile.parere.profile,
          {
            title: job.title,
            company: job.company,
            location: job.location,
            workMode: job.workMode,
            description:
              job.description ??
              (job.descriptionHtml ? parseHTML(job.descriptionHtml).document.body.textContent : null),
            reasons: job.reasons,
            ...(bando?.text ? { bando: bando.text } : {}),
          },
          profile.parere.model,
        );
        const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
        return { profile: profile.parere, input, hash };
      }

      function opinionFor(key: string) {
        const job = db.select().from(jobs).where(eq(jobs.key, key)).get();
        if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: 'Offerta non trovata' });
        const bando = db.select().from(bandoTexts).where(eq(bandoTexts.key, key)).get();
        const saved = db.select().from(opinions).where(eq(opinions.key, key)).get();
        return { ...inputFor(job, bando), saved };
      }

      function withPossibility(opinion: StoredOpinion) {
        return { ...opinion, possibility: possibilityOf(opinion) };
      }

      function showOpinion(saved: typeof opinions.$inferSelect, hash: string) {
        return {
          verdict: withPossibility(storedOpinionSchema.parse(saved.verdict)),
          createdAt: saved.createdAt.getTime(),
          outdated: saved.inputHash !== hash,
        };
      }

      /** Every action refuses unless the profile parsed. */
      function ready() {
        if (!parsedProfile.success) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'invalid-config' });
        return parsedProfile.data;
      }

      async function judge(key: string, cap: number, signal: AbortSignal) {
        let current = opinionFor(key);
        const job = db.select().from(jobs).where(eq(jobs.key, key)).get();
        const cached = db.select().from(bandoTexts).where(eq(bandoTexts.key, key)).get();
        if (job?.site === 'inpa' && !cached) {
          const text = await readBando(job.url, effectiveFetch, run, signal);
          if (text) {
            db.insert(bandoTexts)
              .values({ key, text, fetchedAt: new Date(clock.now()) })
              .onConflictDoNothing()
              .run();
            current = opinionFor(key);
          } else log.warn('Bando text unavailable');
        }
        const gatedFetch: typeof fetch = (input, init) =>
          gate(
            cap,
            (gateSignal) => {
              if (signal.aborted) throw signal.reason;
              return effectiveFetch(input, { ...init, signal: AbortSignal.any([signal, gateSignal]) });
            },
            { minIntervalMs: parereIntervalMs(current.profile) },
          );
        const verdict = await fetchOpinion(
          gatedFetch,
          current.profile.key ?? '',
          current.input,
          signal,
          undefined,
          current.profile.provider,
        );
        const saved = { key, verdict, model: current.profile.model, inputHash: current.hash, createdAt: new Date() };
        db.insert(opinions).values(saved).onConflictDoUpdate({ target: opinions.key, set: saved }).run();
        return showOpinion(saved, current.hash);
      }

      function startPareri() {
        if (pareriWork) return false;
        const profile = ready().parere;
        const { jobs: rows, rules } = list();
        const candidates = rows
          .filter((row) => tabOf(row, undefined, rules) === 'review')
          .map((row) => ({ row, opinion: opinionFor(row.key) }))
          .filter(({ opinion }) => !opinion.saved || opinion.saved.inputHash !== opinion.hash)
          .toSorted(
            (a, b) => Number(Boolean(a.opinion.saved)) - Number(Boolean(b.opinion.saved)) || b.row.total - a.row.total,
          );
        pareri = { running: true, done: 0, remaining: candidates.length, reason: null, date: clock.now() };
        const entry = { controller: new AbortController(), done: Promise.resolve() };
        const job = trackJob('lavoro.pareri', { onCancel: () => entry.controller.abort() });
        let failed = false;
        job.log(`Pareri avviati: ${candidates.length} annunci`);
        pareriWork = entry;
        async function work() {
          if (!pareri) return;
          if (missingSetup(profile)) {
            pareri.reason = 'chiave o profilo mancante';
            return;
          }
          for (const { row } of candidates) {
            if (entry.controller.signal.aborted) break;
            if (gate.used() >= profile.dailyCap - profile.manualReserve) {
              pareri.reason = 'limite giornaliero';
              break;
            }
            let retried = false;
            for (;;) {
              try {
                await judge(row.key, profile.dailyCap - profile.manualReserve, entry.controller.signal);
                pareri.done++;
                job.log(`Pareri completati: ${pareri.done}`);
                pareri.remaining--;
                break;
              } catch (error) {
                if (entry.controller.signal.aborted) break;
                job.log(`[parere] ${opinionFailure(error)}`, 'stderr');
                if (error instanceof LlmGateError && error.reason === 'cap') {
                  pareri.reason = 'limite giornaliero';
                  break;
                }
                if (error instanceof OpinionProviderError && [401, 403].includes(error.status)) {
                  pareri.reason = 'chiave non valida';
                  break;
                }
                if (error instanceof OpinionProviderError && error.status === 429) {
                  if (retried) {
                    pareri.reason = 'quota Google esaurita';
                    break;
                  }
                  retried = true;
                  await clock.sleep(60_000, entry.controller.signal);
                  continue;
                }
                failed = true;
                log.warn({ reason: opinionFailure(error) }, 'Parere failed');
                pareri.remaining--;
                break;
              }
            }
            if (pareri.reason || entry.controller.signal.aborted) break;
            void live.notify();
          }
        }
        entry.done = work()
          .catch(() => {
            failed = true;
            job.log('Esecuzione pareri interrotta da un errore', 'stderr');
            log.error('Pareri run failed');
          })
          .finally(() => {
            if (pareri?.reason) {
              failed = true;
              job.log(`Pareri interrotti: ${pareri.reason}`, 'stderr');
            }
            if (pareri) {
              pareri.running = false;
              job.log(`Pareri conclusi: ${pareri.done} completati, ${pareri.remaining} rimanenti`);
            }
            job.finish(entry.controller.signal.aborted ? 'cancelled' : failed ? 'failed' : 'completed');
            pareriWork = undefined;
            void live.notify();
          });
        void live.notify();
        return true;
      }

      function list(forAgent = false): { jobs: JobRow[]; rules: RuleRow[] } {
        ready();
        const joined = db
          .select({ job: jobs, saved: opinions, bando: bandoTexts })
          .from(jobs)
          .leftJoin(opinions, eq(opinions.key, jobs.key))
          .leftJoin(bandoTexts, eq(bandoTexts.key, jobs.key))
          .all();
        const allJobs = joined.map(({ job }) => job);
        const opinionsByKey = new Map(
          joined.map(({ job, saved, bando }) => {
            const parsed = saved ? storedOpinionSchema.safeParse(saved.verdict) : undefined;
            // An unreadable verdict shows as none: one bad row must not break the whole list.
            if (!saved || !parsed?.success) return [job.key, null] as const;
            const verdict = parsed.data;
            return [
              job.key,
              {
                verdict: verdict.verdict,
                possibility: possibilityOf(verdict),
                codes: verdict.codes,
                unverified: verdict.unverified,
                outdated: saved.inputHash !== inputFor(job, bando).hash,
              },
            ] as const;
          }),
        );
        const allArchives = new Map(
          db
            .select()
            .from(jobArchive)
            .all()
            .map((r) => [r.key, r.at.getTime()]),
        );
        const allDeleteds = new Map(
          db
            .select()
            .from(jobDeleted)
            .all()
            .map((r) => [r.key, r.at.getTime()]),
        );
        const allInterviewsList = db.select().from(jobInterview).all();
        const interviewsByKey = new Map<string, InterviewRow[]>();
        for (const i of allInterviewsList) {
          const item: InterviewRow = {
            id: i.id,
            key: i.key,
            scheduledAt: i.scheduledAt.getTime(),
            // Interview labels can carry meeting URLs/passcodes from mail: hide them from cloud-model MCP agents.
            ...(forAgent ? {} : { label: i.label }),
          };
          const list = interviewsByKey.get(i.key);
          if (list) list.push(item);
          else interviewsByKey.set(i.key, [item]);
        }

        const mailReasonsByKey = new Map<string, Set<string>>();
        if (forAgent) {
          for (const proposal of db
            .select({ key: mailProposals.key, why: mailProposals.why })
            .from(mailProposals)
            .where(and(eq(mailProposals.kind, 'status'), eq(mailProposals.resolution, 'accepted')))
            .all()) {
            const set = mailReasonsByKey.get(proposal.key) ?? new Set<string>();
            set.add(proposal.why.slice(0, 300));
            mailReasonsByKey.set(proposal.key, set);
          }
        }

        // One read for every card: the newest linked mail per application, never a request per card.
        const lastMails = new Map<string, NonNullable<ApplicationRow['lastMail']>>();
        for (const link of db
          .select({
            key: jobMailLink.key,
            receivedAt: mailChecked.receivedAt,
            linkedAt: jobMailLink.linkedAt,
            answer: mailChecked.answer,
          })
          .from(jobMailLink)
          .leftJoin(
            mailChecked,
            and(eq(mailChecked.account, jobMailLink.account), eq(mailChecked.messageId, jobMailLink.messageId)),
          )
          .all()) {
          const at = (link.receivedAt ?? link.linkedAt).getTime();
          if (at <= (lastMails.get(link.key)?.at ?? -1)) continue;
          const answer = mailAnswerSchema.safeParse(link.answer);
          lastMails.set(link.key, { at, kind: answer.success ? answer.data.kind : null });
        }

        const allApplications = new Map(
          db
            .select()
            .from(jobApplied)
            .all()
            .map((r) => {
              const mailDerived = forAgent && r.reason !== null && mailReasonsByKey.get(r.key)?.has(r.reason);
              return [
                r.key,
                {
                  appliedAt: r.appliedAt.getTime(),
                  status: r.status,
                  closedAt: r.closedAt ? r.closedAt.getTime() : null,
                  reason: mailDerived ? null : r.reason,
                  notes: r.notes,
                  interviews: (interviewsByKey.get(r.key) ?? []).toSorted((a, b) => a.scheduledAt - b.scheduledAt),
                  lastMail: lastMails.get(r.key) ?? null,
                },
              ];
            }),
        );

        const companyApplications = sameCompanyApplications(
          allJobs,
          [...allApplications].map(([key, application]) => ({ key, ...application })),
          clock.now(),
        );
        const mappedJobs: JobRow[] = allJobs.map((j) => ({
          ...j,
          postedAt: j.postedAt ? j.postedAt.getTime() : null,
          firstSeen: j.firstSeen.getTime(),
          importedAt: j.importedAt ? j.importedAt.getTime() : null,
          archivedAt: allArchives.get(j.key) ?? null,
          deletedAt: allDeleteds.get(j.key) ?? null,
          application: allApplications.get(j.key) ?? null,
          companyApplications: companyApplications.get(j.key) ?? [],
          opinion: opinionsByKey.get(j.key) ?? null,
        }));
        const allRules = db
          .select()
          .from(blacklistRules)
          .all()
          .map((r) => ({
            id: r.id,
            enabled: r.enabled,
            field: r.field,
            matchType: r.matchType,
            value: r.value,
            note: r.note,
            createdAt: r.createdAt.getTime(),
          }));
        return { jobs: mappedJobs, rules: allRules };
      }

      const postingTextLimit = 20_000;

      /** What an agent reads of one posting: the row, the text cut, the full opinion, linked mail by subject and date. */
      function posting(identifier: string, forAgent = false) {
        const { jobs: rows, rules } = list(forAgent);
        const row = rows.find((candidate) => candidate.key === identifier || postingId(candidate.key) === identifier);
        if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Offerta non trovata' });
        const key = row.key;
        const { description, descriptionHtml, ...fields } = row;
        const text =
          description ?? (descriptionHtml ? parseHTML(descriptionHtml).document.body.textContent : null) ?? '';
        const current = opinionFor(key);
        const parsed = current.saved ? storedOpinionSchema.safeParse(current.saved.verdict) : undefined;
        // Plan 73 approved exception: linked mail subject and date remain visible to agents (never mail body or sender),
        // whereas mail-derived rejection `reason` and interview `label` are stripped when `forAgent` is true.
        const mail = db
          .select({ subject: mailChecked.subject, receivedAt: mailChecked.receivedAt, linkedAt: jobMailLink.linkedAt })
          .from(jobMailLink)
          .leftJoin(
            mailChecked,
            and(eq(mailChecked.account, jobMailLink.account), eq(mailChecked.messageId, jobMailLink.messageId)),
          )
          .where(eq(jobMailLink.key, key))
          .all()
          .map((link) => ({ subject: link.subject, date: (link.receivedAt ?? link.linkedAt).getTime() }));
        return {
          ...fields,
          segment: tabOf(row, undefined, rules),
          description: text.slice(0, postingTextLimit),
          descriptionCut: text.length > postingTextLimit,
          opinion:
            current.saved && parsed?.success
              ? { ...withPossibility(parsed.data), outdated: current.saved.inputHash !== current.hash }
              : null,
          mail,
        };
      }

      /** Up to `limit` rows of one segment in the order of Annunci (opinion, then score). */
      function shortlist(input: { segment: 'review' | 'applied'; limit: number }) {
        const { jobs: rows, rules } = list();
        const tab = input.segment === 'applied' ? 'applications' : 'review';
        return sortJobs(
          rows.filter((row) => tabOf(row, undefined, rules) === tab),
          'opinion',
        )
          .slice(0, input.limit)
          .map((row) => ({
            key: row.key,
            title: row.title,
            company: row.company,
            place: row.location,
            score: row.total,
            verdict: row.opinion?.verdict ?? null,
            possibility: row.opinion?.possibility ?? null,
          }));
      }

      function start(kind: CollectionKind) {
        const validProfile = ready();
        if (active) throw new TRPCError({ code: 'CONFLICT', message: 'collection-running' });
        const entry: { controller: AbortController; progress: Progress | null; done: Promise<void> } = {
          controller: new AbortController(),
          progress: null,
          done: Promise.resolve(),
        };
        const job = trackJob(kind === 'prova' ? 'lavoro.prova' : 'lavoro.raccogli', {
          onCancel: () => entry.controller.abort(),
        });
        let status: 'completed' | 'failed' | 'cancelled' = 'failed';
        active = entry;
        dryRun = null;
        dryRunRequirements = null;
        const deps = { db, profile: validProfile, sources: registry, clock, fetch, log, run };
        entry.done = runCollection(deps, kind, entry.controller.signal, (progress) => {
          const previous = entry.progress;
          if (!previous || progress.site !== previous.site || progress.searchesDone !== previous.searchesDone)
            job.log(
              `[${progress.site ?? 'raccolta'}] ${progress.searchesDone}/${progress.searchesTotal} ricerche; trovati ${progress.newCount} nuovi, ${progress.excludedCount} esclusi`,
            );
          if (progress.failedSearches > (previous?.failedSearches ?? 0))
            job.log(`Ricerche non riuscite: ${progress.failedSearches}`, 'stderr');
          entry.progress = progress;
          void live.notify();
        })
          .then((outcome) => {
            status = outcome.status === 'done' ? 'completed' : outcome.status === 'cancelled' ? 'cancelled' : 'failed';
            const progress = entry.progress;
            if (progress)
              job.log(`Raccolta conclusa: trovati ${progress.newCount} nuovi, ${progress.excludedCount} esclusi`);
            if (kind === 'prova') {
              dryRun = outcome.dryRun;
              dryRunRequirements = outcome.requirements;
            }
            if (kind === 'raccolta' && validProfile.parere.auto && ['done', 'partial'].includes(outcome.status))
              startPareri();
          })
          // No payload: an error from a source or a driver can carry a URL or a row.
          .catch(() => {
            job.log('Raccolta interrotta da un errore', 'stderr');
            log.error('Lavoro collection crashed');
          })
          .finally(() => {
            job.finish(entry.controller.signal.aborted ? 'cancelled' : status);
            active = undefined;
            void live.notify();
          });
        void live.notify();
      }

      const mailConfig = parsedProfile.success ? parsedProfile.data.mailCheck : null;

      /** One mail check at a time; the work reads only mail no earlier run read, so calling it often is cheap. */
      function startMailCheck() {
        if (!mail || !mailConfig || mailConfig.accounts.length === 0 || mailWork) return false;
        const entry = { controller: new AbortController(), done: Promise.resolve() };
        mailWork = entry;
        mailState = { running: true, done: 0, remaining: 0, reason: null, date: clock.now() };
        entry.done = runMailCheck(
          { db, mail, fetch: effectiveFetch, gate, log, now: clock.now, config: mailConfig },
          entry.controller.signal,
          (progress) => {
            if (mailState) Object.assign(mailState, progress);
            void live.notify();
          },
        )
          .then((outcome) => {
            if (mailState) mailState.reason = outcome.reason;
          })
          // No payload: an error here can carry a subject or an address.
          .catch(() => log.error('Mail check failed'))
          .finally(() => {
            if (mailState) mailState.running = false;
            mailWork = undefined;
            void live.notify();
          });
        void live.notify();
        return true;
      }
      if (mail && mailConfig?.auto && mailConfig.accounts.length > 0) {
        // shortcut: a fixed ten minute poll while the server runs; step 39 owns mail polling without a page.
        mailTimers = [setTimeout(startMailCheck, 30_000), setInterval(startMailCheck, 1_800_000)];
        for (const timer of mailTimers) timer.unref();
      }

      return {
        router: router({
          preparation: agentOrLoopbackProcedure.input(z.object({ key: z.string() })).query(async ({ input }) => {
            const job = db.select().from(jobs).where(eq(jobs.key, input.key)).get();
            if (!job) return null;
            const note = await noteFile(skillsDir, 'colloquio', noteDirectory(job.company, job.title));
            return note && { file: note.file, date: note.date, blocks: note.blocks };
          }),
          candidaturaPrompt: loopbackProcedure.input(z.object({ key: z.string() })).query(async ({ ctx, input }) => {
            if (!db.select({ key: jobs.key }).from(jobs).where(eq(jobs.key, input.key)).get())
              throw new TRPCError({ code: 'NOT_FOUND', message: 'Offerta non trovata' });
            return candidaturaPrompt(ctx.config.mcp.client, input.key, skillsDir);
          }),
          gaps: agentOrLoopbackProcedure.query(async () => {
            const note = await noteFile(skillsDir, 'lacune');
            return note && { file: note.file, date: note.date, blocks: note.blocks };
          }),
          openPreparation: loopbackProcedure
            .meta({ label: 'Apri preparazione', description: 'Open the latest interview preparation file on the PC' })
            .input(z.object({ key: z.string() }))
            .mutation(async ({ input }) => {
              const job = db.select().from(jobs).where(eq(jobs.key, input.key)).get();
              const note = job && (await noteFile(skillsDir, 'colloquio', noteDirectory(job.company, job.title)));
              if (!note) throw new TRPCError({ code: 'NOT_FOUND' });
              const { code } = await run('xdg-open', [note.path]);
              if (code !== 0) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
            }),
          opinion: loopbackProcedure.input(z.object({ key: z.string() })).query(({ input }) => {
            const { saved, hash } = opinionFor(input.key);
            return saved ? showOpinion(saved, hash) : null;
          }),
          openCandidatura: loopbackProcedure
            .meta({
              label: 'Prepara candidatura',
              description:
                'Open a terminal on the PC with the selected agent following the candidatura skill on a posting.',
            })
            .input(z.object({ key: z.string() }))
            .mutation(async ({ ctx, input }) => {
              if (!db.select({ key: jobs.key }).from(jobs).where(eq(jobs.key, input.key)).get())
                throw new TRPCError({ code: 'NOT_FOUND', message: 'Offerta non trovata' });
              const folder = await candidaturaFolder(skillsDir);
              const terminal = parsedProfile.success ? parsedProfile.data.candidatura.terminal : defaultTerminal;
              const prompt = await candidaturaPrompt(ctx.config.mcp.client, input.key, skillsDir);
              const port = Number(process.env.HUB_PORT ?? 4180);
              const hubMcpUrl = `http://127.0.0.1:${Number.isFinite(port) && port > 0 ? port : 4180}/mcp`;
              // systemd-run starts the terminal as a transient user unit and returns at once: `run` waits for its child
              // and kills it after the timeout, which a terminal that stays open would hit. The user manager has the
              // Wayland environment (checked with `systemctl --user show-environment`), like Hub's own unit.
              const { code } = await run('systemd-run', [
                '--user',
                '--collect',
                '--quiet',
                `--working-directory=${folder}`,
                ...terminal.map((part) => part.replaceAll('{folder}', folder)),
                ...candidaturaClientArgs(ctx.config.mcp.client, prompt, hubMcpUrl),
              ]);
              if (code !== 0) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Terminale non avviato' });
            }),
          requestOpinion: loopbackProcedure
            .meta({ label: 'Richiedi parere', description: 'Request an opinion on a job posting.' })
            .input(z.object({ key: z.string(), redo: z.boolean().default(false) }))
            .mutation(async ({ input }) => {
              const current = opinionFor(input.key);
              if (current.saved && !input.redo) return showOpinion(current.saved, current.hash);
              if (missingSetup(current.profile))
                throw new TRPCError({
                  code: 'PRECONDITION_FAILED',
                  message: 'Inserisci chiave e profilo nelle impostazioni',
                });
              try {
                return await judge(input.key, current.profile.dailyCap, new AbortController().signal);
              } catch (error) {
                log.warn({ reason: opinionFailure(error) }, 'Parere failed');
                let message = 'Servizio non disponibile';
                if (error instanceof OpinionProviderError && (error.status === 401 || error.status === 403))
                  message = 'Chiave non valida';
                if (
                  (error instanceof OpinionProviderError && error.status === 429) ||
                  (error instanceof LlmGateError && error.reason === 'cap')
                )
                  message = 'Quota esaurita';
                if (error instanceof OpinionProviderError && error.status === 503) message = overloaded;
                if (error instanceof LlmGateError && error.reason === 'timeout')
                  message = 'Il modello non ha risposto in tempo';
                throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message });
              }
            }),
          pareriMancanti: loopbackProcedure
            .meta({ label: 'Pareri mancanti', description: 'Request missing job opinions in the background.' })
            .mutation(() => ({ started: startPareri() })),
          state: agentOrLoopbackProcedure.query(readState),
          onState: agentOrLoopbackProcedure.subscription(({ signal }) => live.subscribe(signal)),
          list: agentOrLoopbackProcedure.query(({ ctx }) => list(ctx.client.kind === 'agent')),
          summary: agentOrLoopbackProcedure.query(() => {
            const { jobs: rows, rules } = list();
            const last = db
              .select({ finishedAt: collections.finishedAt })
              .from(collections)
              .where(eq(collections.kind, 'raccolta'))
              .orderBy(desc(collections.id))
              .limit(1)
              .get();
            return summarizeLavoro(rows, rules, clock.now(), last?.finishedAt.getTime() ?? null);
          }),
          nearMisses: agentOrLoopbackProcedure.query((): NearMissesState => {
            const profile = ready();
            const stored = db.select().from(nearMisses).orderBy(desc(nearMisses.lastSeen), nearMisses.key).all();
            return {
              rows: stored.map((row) => ({
                key: row.key,
                url: row.url,
                title: row.title,
                company: row.company,
                site: row.site,
                score: row.score,
                missing: pointsMissing(row),
                reasons: row.reasons,
                lastSeen: row.lastSeen.getTime(),
              })),
              words: suggestWords(stored, profile),
            };
          }),
          addNearMiss: agentOrLoopbackProcedure
            .meta({
              label: 'Aggiungi alla lista',
              description:
                'Move a near-miss posting into the list of postings to review, with its stored score and text. No fetch.',
            })
            .input(z.object({ key: z.string().min(1) }))
            .mutation(({ input }) => {
              const profile = ready();
              return db.transaction((tx) => {
                const miss = tx.select().from(nearMisses).where(eq(nearMisses.key, input.key)).get();
                if (!miss) throw new TRPCError({ code: 'NOT_FOUND', message: 'Annuncio non trovato' });
                const taken = tx.select({ key: jobs.key }).from(jobs).where(eq(jobs.url, miss.url)).get();
                const description = miss.description ?? undefined;
                const posting = {
                  title: miss.title,
                  company: miss.company,
                  location: miss.location,
                  site: miss.site,
                  description,
                };
                const scorer = createScorer(profile);
                const workMode = scorer.score(posting).workMode;
                if (!taken && !tx.select({ key: jobs.key }).from(jobs).where(eq(jobs.key, miss.key)).get())
                  tx.insert(jobs)
                    .values({
                      key: miss.key,
                      comparisonKey: comparisonKey(miss.company, miss.title, miss.location),
                      title: miss.title,
                      company: miss.company,
                      location: miss.location,
                      site: miss.site,
                      url: miss.url,
                      applyUrl: null,
                      score: miss.score,
                      total: miss.total,
                      reasons: ['aggiunta a mano', ...miss.reasons],
                      categories: scorer.categories(posting),
                      description: miss.description,
                      descriptionHtml: null,
                      workMode,
                      isRemote: workMode === 'remote',
                      detailsMissing: false,
                      postedAt: null,
                      firstSeen: new Date(clock.now()),
                      // The same mark as an import: the owner put it in the list, the collection did not.
                      importedAt: new Date(clock.now()),
                      blacklistRule: null,
                    })
                    .run();
                tx.delete(nearMisses).where(eq(nearMisses.key, miss.key)).run();
                return { success: true, key: miss.key };
              });
            }),
          dismissNearMiss: agentOrLoopbackProcedure
            .input(z.object({ key: z.string().min(1) }))
            .mutation(({ ctx, input }) => {
              forbidAgent(ctx);
              return db.transaction((tx) => {
                const miss = tx
                  .select({ key: nearMisses.key })
                  .from(nearMisses)
                  .where(eq(nearMisses.key, input.key))
                  .get();
                if (!miss) throw new TRPCError({ code: 'NOT_FOUND', message: 'Annuncio non trovato' });
                tx.delete(nearMisses).where(eq(nearMisses.key, miss.key)).run();
                tx.insert(purgedJobs)
                  .values({ key: miss.key, purgedAt: new Date(clock.now()), codes: null })
                  .onConflictDoNothing()
                  .run();
                return { success: true, key: miss.key };
              });
            }),
          dismissAllNearMisses: agentOrLoopbackProcedure.mutation(({ ctx }) => {
            forbidAgent(ctx);
            return db.transaction((tx) => {
              const keys = tx
                .select({ key: nearMisses.key })
                .from(nearMisses)
                .all()
                .map((row) => row.key);
              if (keys.length) {
                const now = new Date(clock.now());
                for (const key of keys)
                  tx.insert(purgedJobs).values({ key, purgedAt: now, codes: null }).onConflictDoNothing().run();
                tx.delete(nearMisses).run();
              }
              return { success: true, count: keys.length };
            });
          }),
          shortlist: agentOrLoopbackProcedure
            .meta({
              label: 'Elenco breve',
              description:
                'Up to 20 postings of one segment (review or applied), best Possibilità first, then Interesse: key, title, company, place, score (Interesse), verdict, possibility.',
            })
            .input(
              z.object({ segment: z.enum(['review', 'applied']), limit: z.number().int().min(1).max(20).default(20) }),
            )
            .query(({ input }) => shortlist(input)),
          // The palette's records (step 64), at the level of `list`: never open to a paired phone. No `.meta`, so they
          // are not agent tools. Postings without an application, and the applications, are two groups.
          searchRecords: router({
            postings: agentOrLoopbackProcedure.input(searchInput).query(({ ctx, input }) => {
              const { jobs: rows, rules } = list(ctx.client.kind === 'agent');
              return searchPostings(rows, rules, input.query);
            }),
            applications: agentOrLoopbackProcedure.input(searchInput).query(({ ctx, input }) => {
              return searchApplications(list(ctx.client.kind === 'agent').jobs, input.query, clock.now());
            }),
            // One posting for a post-it's link (step 71): the fields a caption needs and its tab, not the whole list.
            get: agentOrLoopbackProcedure.input(z.object({ key: z.string().min(1) })).query(({ ctx, input }) => {
              const { jobs: rows, rules } = list(ctx.client.kind === 'agent');
              const job = rows.find((row) => row.key === input.key);
              if (!job) return null;
              return {
                title: job.title,
                company: job.company,
                location: job.location,
                tab: tabOf(job, undefined, rules),
              };
            }),
          }),
          posting: agentOrLoopbackProcedure
            .meta({
              label: 'Leggi annuncio',
              description:
                'One posting in full by key or opaque id: its fields, the description as text (cut at 20000 characters), the opinion, the application and the subjects and dates of linked mail.',
            })
            .input(z.object({ key: z.string().min(1) }))
            .query(({ ctx, input }) => posting(input.key, ctx.client.kind === 'agent')),
          setFlag: agentOrLoopbackProcedure
            .meta({
              label: 'Imposta stato offerta',
              description: 'Set or clear a status flag (archived, deleted, applied) for job postings.',
            })
            .input(
              z.object({
                keys: z.array(z.string().min(1)).min(1).max(500),
                flag: z.enum(['archived', 'deleted', 'applied']),
                value: z.boolean(),
                // Only removing an application asks for it (see below); `meta.danger` cannot depend on the input.
                confirmed: z.literal(true).optional(),
              }),
            )
            .mutation(({ input, ctx }) => {
              if (input.flag === 'applied' && !input.value) {
                // Removing an application is `deleteApplication`'s hold; an agent goes through that one's queue.
                if (ctx.client.kind === 'agent')
                  throw new TRPCError({ code: 'FORBIDDEN', message: 'An agent cannot confirm this action' });
                if (!input.confirmed)
                  throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Hold to confirm this action' });
              }
              ready();
              const uniqueKeys = Array.from(new Set(input.keys));
              const now = clock.now();

              return db.transaction((tx) => {
                const knownRows = tx.select({ key: jobs.key }).from(jobs).where(inArray(jobs.key, uniqueKeys)).all();
                const validKeys = knownRows.map((r) => r.key);
                if (validKeys.length === 0) return { changed: 0 };

                let changed = 0;
                if (input.flag === 'archived') {
                  const existing = new Set(
                    tx
                      .select({ key: jobArchive.key })
                      .from(jobArchive)
                      .where(inArray(jobArchive.key, validKeys))
                      .all()
                      .map((r) => r.key),
                  );
                  if (input.value) {
                    const toInsert = validKeys.filter((k) => !existing.has(k));
                    for (const k of toInsert) {
                      tx.insert(jobArchive)
                        .values({ key: k, at: new Date(now) })
                        .run();
                    }
                    changed = toInsert.length;
                  } else {
                    const toDelete = validKeys.filter((k) => existing.has(k));
                    if (toDelete.length > 0) {
                      tx.delete(jobArchive).where(inArray(jobArchive.key, toDelete)).run();
                    }
                    changed = toDelete.length;
                  }
                } else if (input.flag === 'deleted') {
                  const existing = new Set(
                    tx
                      .select({ key: jobDeleted.key })
                      .from(jobDeleted)
                      .where(inArray(jobDeleted.key, validKeys))
                      .all()
                      .map((r) => r.key),
                  );
                  if (input.value) {
                    const toInsert = validKeys.filter((k) => !existing.has(k));
                    for (const k of toInsert) {
                      tx.insert(jobDeleted)
                        .values({ key: k, at: new Date(now) })
                        .run();
                    }
                    changed = toInsert.length;
                  } else {
                    const toDelete = validKeys.filter((k) => existing.has(k));
                    if (toDelete.length > 0) {
                      tx.delete(jobDeleted).where(inArray(jobDeleted.key, toDelete)).run();
                    }
                    changed = toDelete.length;
                  }
                } else if (input.flag === 'applied') {
                  const existing = new Set(
                    tx
                      .select({ key: jobApplied.key })
                      .from(jobApplied)
                      .where(inArray(jobApplied.key, validKeys))
                      .all()
                      .map((r) => r.key),
                  );
                  if (input.value) {
                    const toInsert = validKeys.filter((k) => !existing.has(k));
                    for (const k of toInsert) {
                      tx.insert(jobApplied)
                        .values({ key: k, appliedAt: new Date(now), status: 'pending' })
                        .run();
                      const job = tx.select().from(jobs).where(eq(jobs.key, k)).get();
                      for (const address of postingAddresses(job?.description ?? null))
                        tx.insert(applicationAddress)
                          .values({ key: k, address, origin: 'sent', addedAt: new Date(now) })
                          .onConflictDoNothing()
                          .run();
                    }
                    changed = toInsert.length;
                  } else {
                    const toDelete = validKeys.filter((k) => existing.has(k));
                    if (toDelete.length > 0) {
                      tx.delete(applicationAddress).where(inArray(applicationAddress.key, toDelete)).run();
                      tx.delete(jobInterview).where(inArray(jobInterview.key, toDelete)).run();
                      tx.delete(jobMailLink).where(inArray(jobMailLink.key, toDelete)).run();
                      tx.delete(jobApplied).where(inArray(jobApplied.key, toDelete)).run();
                    }
                    changed = toDelete.length;
                  }
                }
                return { changed };
              });
            }),
          purge: agentOrLoopbackProcedure
            .meta({
              label: 'Elimina definitivamente',
              description: 'Permanently remove deleted job postings and record them as purged.',
              danger: true,
            })
            .input(
              z.object({
                keys: z.array(z.string().min(1)).min(1).max(500),
                confirmed: z.literal(true),
              }),
            )
            .mutation(({ input }) => {
              ready();
              const uniqueKeys = Array.from(new Set(input.keys));
              const now = clock.now();

              return db.transaction((tx) => {
                const existingJobs = new Set(
                  tx
                    .select({ key: jobs.key })
                    .from(jobs)
                    .where(inArray(jobs.key, uniqueKeys))
                    .all()
                    .map((r) => r.key),
                );
                const inTrash = new Set(
                  tx
                    .select({ key: jobDeleted.key })
                    .from(jobDeleted)
                    .where(inArray(jobDeleted.key, uniqueKeys))
                    .all()
                    .map((r) => r.key),
                );
                const withApplication = new Set(
                  tx
                    .select({ key: jobApplied.key })
                    .from(jobApplied)
                    .where(inArray(jobApplied.key, uniqueKeys))
                    .all()
                    .map((r) => r.key),
                );

                for (const key of uniqueKeys) {
                  if (!existingJobs.has(key) || !inTrash.has(key) || withApplication.has(key)) {
                    throw new TRPCError({
                      code: 'PRECONDITION_FAILED',
                      message: 'Only postings in trash without an application can be purged',
                    });
                  }
                }

                const savedCodes = new Map(
                  tx
                    .select()
                    .from(opinions)
                    .where(inArray(opinions.key, uniqueKeys))
                    .all()
                    .map((row) => [row.key, codesToKeep(row.verdict)]),
                );
                tx.delete(jobDeleted).where(inArray(jobDeleted.key, uniqueKeys)).run();
                tx.delete(jobArchive).where(inArray(jobArchive.key, uniqueKeys)).run();
                tx.delete(jobs).where(inArray(jobs.key, uniqueKeys)).run();

                for (const key of uniqueKeys) {
                  tx.insert(purgedJobs)
                    .values({ key, purgedAt: new Date(now), codes: savedCodes.get(key) ?? null })
                    .onConflictDoUpdate({
                      target: purgedJobs.key,
                      set: { purgedAt: sql`excluded.purged_at`, codes: sql`excluded.codes` },
                    })
                    .run();
                }

                return { removed: uniqueKeys };
              });
            }),
          prova: agentOrLoopbackProcedure
            .meta({
              label: 'Prova raccolta',
              description:
                'Dry run of the job collection: the same searches, filters and scoring, but nothing is saved or sent. The postings it would list appear in the Lavoro state.',
            })
            .mutation(() => {
              start('prova');
              return { started: true };
            }),
          raccogli: agentOrLoopbackProcedure
            .meta({
              label: 'Raccogli offerte',
              description:
                'Start collecting job postings in the background. Returns at once; progress is in the Lavoro state and one desktop notification summarises the new postings.',
            })
            .mutation(() => {
              start('raccolta');
              return { started: true };
            }),
          annulla: agentOrLoopbackProcedure
            .meta({
              label: 'Annulla raccolta',
              description:
                'Cancel the running job collection. Postings already saved are kept and the summary is still sent.',
            })
            .mutation(() => {
              ready();
              active?.controller.abort();
              return { cancelled: active !== undefined };
            }),
          setApplication: agentOrLoopbackProcedure
            .meta({
              label: 'Aggiorna candidatura',
              description: 'Update application status, closing date, reason or notes for a job posting.',
            })
            .input(
              z.object({
                key: z.string().min(1),
                status: z.enum(applicationStatuses).optional(),
                closedAt: z.number().int().positive().nullable().optional(),
                reason: z.string().nullable().optional(),
                notes: z.string().nullable().optional(),
                appliedAt: z.number().int().positive().optional(),
              }),
            )
            .mutation(({ ctx, input }) => {
              if (input.notes !== undefined || input.appliedAt !== undefined) forbidAgent(ctx);
              ready();
              return db.transaction((tx) => {
                const job = tx.select().from(jobs).where(eq(jobs.key, input.key)).get();
                if (!job) {
                  throw new TRPCError({ code: 'NOT_FOUND', message: 'Job posting not found' });
                }
                const existing = tx.select().from(jobApplied).where(eq(jobApplied.key, input.key)).get();
                const now = clock.now();
                if (!existing) {
                  tx.insert(jobApplied)
                    .values({
                      key: input.key,
                      appliedAt: new Date(input.appliedAt ?? now),
                      status: input.status ?? 'pending',
                      closedAt: input.closedAt ? new Date(input.closedAt) : null,
                      reason: input.reason ?? null,
                      notes: input.notes ?? null,
                    })
                    .run();
                  for (const address of postingAddresses(job.description))
                    tx.insert(applicationAddress)
                      .values({ key: input.key, address, origin: 'sent', addedAt: new Date(now) })
                      .onConflictDoNothing()
                      .run();
                } else {
                  const updates: {
                    status?: ApplicationStatus;
                    appliedAt?: Date;
                    closedAt?: Date | null;
                    reason?: string | null;
                    notes?: string | null;
                  } = {};
                  if (input.status !== undefined) updates.status = input.status;
                  if (input.appliedAt !== undefined) updates.appliedAt = new Date(input.appliedAt);
                  if (input.closedAt !== undefined) {
                    updates.closedAt = input.closedAt ? new Date(input.closedAt) : null;
                  }
                  if (input.reason !== undefined) updates.reason = input.reason;
                  if (input.notes !== undefined) updates.notes = input.notes;

                  if (Object.keys(updates).length > 0) {
                    tx.update(jobApplied).set(updates).where(eq(jobApplied.key, input.key)).run();
                  }
                }
                return { success: true, key: input.key };
              });
            }),
          deleteApplication: agentOrLoopbackProcedure
            .meta({
              label: 'Rimuovi candidatura',
              description: 'Remove an application and all its notes and interviews.',
              danger: true,
            })
            .input(
              z.object({
                key: z.string().min(1),
                confirmed: z.literal(true),
              }),
            )
            .mutation(({ input }) => {
              ready();
              return db.transaction((tx) => {
                tx.delete(applicationAddress).where(eq(applicationAddress.key, input.key)).run();
                tx.delete(jobInterview).where(eq(jobInterview.key, input.key)).run();
                tx.delete(jobMailLink).where(eq(jobMailLink.key, input.key)).run();
                const res = tx.delete(jobApplied).where(eq(jobApplied.key, input.key)).run();
                return { removed: res.changes > 0, key: input.key };
              });
            }),
          // What the Calendario page shows from Lavoro in a range of days (inclusive, YYYY-MM-DD): saved interviews
          // (with their time, the page reads the local day) and open "Da fare" mails with a deadline.
          calendar: loopbackProcedure
            .input(
              z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
            )
            .query(({ input }) => {
              ready();
              const [fy = 0, fm = 1, fd = 1] = input.from.split('-').map(Number);
              const [ty = 0, tm = 1, td = 1] = input.to.split('-').map(Number);
              const start = new Date(fy, fm - 1, fd).getTime();
              const end = new Date(ty, tm - 1, td + 1).getTime();
              return {
                interviews: db
                  .select()
                  .from(jobInterview)
                  .all()
                  .filter((row) => row.scheduledAt.getTime() >= start && row.scheduledAt.getTime() < end)
                  .map((row) => ({ id: row.id, key: row.key, at: row.scheduledAt.getTime(), label: row.label })),
                deadlines: todoDeadlines(db.select().from(mailChecked).all(), input.from, input.to),
              };
            }),
          addresses: router({
            list: loopbackProcedure.input(z.object({ key: z.string().min(1) })).query(({ input }) => {
              ready();
              return db.select().from(applicationAddress).where(eq(applicationAddress.key, input.key)).all();
            }),
            add: loopbackProcedure
              .input(
                z.object({
                  key: z.string().min(1),
                  address: z.email().max(320),
                  origin: z.enum(['manual', 'sent']).default('manual'),
                }),
              )
              .mutation(({ input }) => {
                ready();
                if (!db.select().from(jobApplied).where(eq(jobApplied.key, input.key)).get())
                  throw new TRPCError({ code: 'NOT_FOUND', message: 'Application not found' });
                db.insert(applicationAddress)
                  .values({
                    key: input.key,
                    address: input.address.toLowerCase(),
                    origin: input.origin,
                    addedAt: new Date(clock.now()),
                  })
                  .onConflictDoNothing()
                  .run();
                return { success: true };
              }),
            remove: loopbackProcedure
              .input(z.object({ key: z.string().min(1), address: z.email().max(320) }))
              .mutation(({ input }) => {
                ready();
                db.delete(applicationAddress)
                  .where(
                    and(
                      eq(applicationAddress.key, input.key),
                      eq(applicationAddress.address, input.address.toLowerCase()),
                    ),
                  )
                  .run();
                return { success: true };
              }),
            suggestions: loopbackProcedure.input(z.object({ key: z.string().min(1) })).query(async ({ input }) => {
              ready();
              const job = db.select().from(jobs).where(eq(jobs.key, input.key)).get();
              const application = db.select().from(jobApplied).where(eq(jobApplied.key, input.key)).get();
              if (!job || !application) return [];
              const existing = new Set(
                db
                  .select()
                  .from(applicationAddress)
                  .where(eq(applicationAddress.key, input.key))
                  .all()
                  .map((row) => row.address),
              );
              const suggestions = new Set<string>();
              if (!mail) return [];
              for (const account of mailConfig?.accounts ?? []) {
                const listing = await mail.listThreadEntries(account, windowStart(60, application.appliedAt));
                for (const entry of listing.entries.filter((row) => row.mailbox === 'sent' && row.counterpart)) {
                  const textBody = await mail.readMessageText(account, 'sent', entry.id);
                  const text = `${entry.subject} ${textBody ?? ''}`;
                  if (
                    (companyEvidence(job.company, text) || companyEvidence(job.title, text)) &&
                    entry.counterpart &&
                    !existing.has(entry.counterpart)
                  )
                    suggestions.add(entry.counterpart);
                }
              }
              return [...suggestions];
            }),
          }),
          // The local-model mail check (step 51). Loopback only: proposals carry subjects, which stay on the PC.
          mailCheck: router({
            info: loopbackProcedure.query(() => ({ enabled: Boolean(mail) && (mailConfig?.accounts.length ?? 0) > 0 })),
            run: loopbackProcedure
              .meta({
                label: 'Controlla posta',
                description: 'Read new mail with the local model and propose links, status changes and interviews.',
              })
              .mutation(() => {
                ready();
                return { started: startMailCheck() };
              }),
            // "Da fare" in Oggi: the mail of the last week that asks the owner for something.
            todos: loopbackProcedure.query(() => {
              ready();
              return selectTodos(db.select().from(mailChecked).all(), clock.now(), mailConfig?.todoDays ?? 7);
            }),
            dismissTodo: loopbackProcedure
              .input(z.object({ id: z.number().int().positive() }))
              .mutation(({ input }) => {
                ready();
                const res = db
                  .update(mailChecked)
                  .set({ dismissedAt: new Date(clock.now()) })
                  .where(and(eq(mailChecked.id, input.id), isNull(mailChecked.dismissedAt)))
                  .run();
                if (res.changes === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'To-do not found' });
                return { success: true };
              }),
            proposals: loopbackProcedure.query(() => {
              ready();
              return db
                .select({
                  id: mailProposals.id,
                  kind: mailProposals.kind,
                  key: mailProposals.key,
                  subject: mailProposals.subject,
                  why: mailProposals.why,
                  status: mailProposals.status,
                  scheduledAt: mailProposals.scheduledAt,
                  label: mailProposals.label,
                  sender: mailChecked.sender,
                  title: jobs.title,
                  company: jobs.company,
                })
                .from(mailProposals)
                .innerJoin(jobs, eq(jobs.key, mailProposals.key))
                .leftJoin(
                  mailChecked,
                  and(
                    eq(mailChecked.account, mailProposals.account),
                    eq(mailChecked.messageId, mailProposals.messageId),
                  ),
                )
                .where(isNull(mailProposals.resolution))
                .orderBy(desc(mailProposals.id))
                .all()
                .map(({ scheduledAt, sender, ...row }) => ({
                  ...row,
                  sender: sender ?? '',
                  scheduledAt: scheduledAt?.getTime() ?? null,
                }));
            }),
            accept: loopbackProcedure
              .input(z.object({ id: z.number().int().positive() }))
              .mutation(async ({ input }) => {
                ready();
                const selected = db
                  .select()
                  .from(mailProposals)
                  .where(and(eq(mailProposals.id, input.id), isNull(mailProposals.resolution)))
                  .get();
                let entries: MailThreadEntry[] = [];
                if (mail && selected?.kind === 'link' && mailConfig?.accounts.includes(selected.account)) {
                  try {
                    entries = (
                      await mail.listThreadEntries(
                        selected.account,
                        windowStart(mailConfig.windowDays, new Date(clock.now())),
                      )
                    ).entries;
                  } catch {
                    /* The confirmation remains valid when mail is unavailable. */
                  }
                }
                return db.transaction((tx) => {
                  const proposal = tx
                    .select()
                    .from(mailProposals)
                    .where(and(eq(mailProposals.id, input.id), isNull(mailProposals.resolution)))
                    .get();
                  if (!proposal) throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' });
                  const app = tx.select().from(jobApplied).where(eq(jobApplied.key, proposal.key)).get();
                  if (!app) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Posting has no application' });
                  if (proposal.kind === 'link') {
                    const { account, messageId, key } = proposal;
                    saveThreadAddresses(tx, key, mail?.threadOf(entries, messageId) ?? null, clock.now());
                    // What the mail asked for was held back until the owner confirmed it belongs here.
                    const read = tx
                      .select()
                      .from(mailChecked)
                      .where(and(eq(mailChecked.account, account), eq(mailChecked.messageId, messageId)))
                      .get();
                    const sender = read?.sender.trim().toLowerCase();
                    if (sender && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sender)) {
                      tx.insert(applicationAddress)
                        .values({ key, address: sender, origin: 'thread', addedAt: new Date(clock.now()) })
                        .onConflictDoNothing()
                        .run();
                    }
                    tx.insert(jobMailLink)
                      .values({ key, account, messageId, linkedAt: new Date(clock.now()) })
                      .onConflictDoNothing()
                      .run();
                    const answer = mailAnswerSchema.safeParse(read?.answer);
                    if (answer.success)
                      proposeFollowUps(tx, {
                        key,
                        account,
                        messageId,
                        subject: proposal.subject,
                        answer: answer.data,
                        now: clock.now(),
                      });
                  } else if (proposal.kind === 'status' && proposal.status) {
                    const closing = ['rejected', 'withdrawn', 'expired'].includes(proposal.status);
                    // The mail's own reason fills an empty one; a reason the owner wrote stays.
                    const reason =
                      proposal.status === 'rejected' && !app.reason?.trim() ? proposal.why.slice(0, 300) : app.reason;
                    tx.update(jobApplied)
                      .set({ status: proposal.status, closedAt: closing ? new Date(clock.now()) : null, reason })
                      .where(eq(jobApplied.key, proposal.key))
                      .run();
                  } else if (proposal.kind === 'interview' && proposal.scheduledAt && proposal.label) {
                    scheduleInterview(tx, {
                      key: proposal.key,
                      scheduledAt: proposal.scheduledAt.getTime(),
                      label: proposal.label,
                    });
                  }
                  tx.update(mailProposals).set({ resolution: 'accepted' }).where(eq(mailProposals.id, input.id)).run();
                  return { success: true };
                });
              }),
            dismiss: loopbackProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => {
              ready();
              const res = db
                .update(mailProposals)
                .set({ resolution: 'dismissed' })
                .where(and(eq(mailProposals.id, input.id), isNull(mailProposals.resolution)))
                .run();
              if (res.changes === 0) throw new TRPCError({ code: 'NOT_FOUND', message: 'Proposal not found' });
              return { success: true };
            }),
          }),
          links: router({
            resolve: loopbackProcedure
              .input(
                z.object({
                  key: z.string().min(1),
                  account: z.string().min(1).max(60),
                  messageId: z.string().min(1).max(320),
                  resolvedMessageId: z.string().min(1).max(320),
                }),
              )
              .mutation(({ input }) => {
                ready();
                const where = and(
                  eq(jobMailLink.key, input.key),
                  eq(jobMailLink.account, input.account),
                  eq(jobMailLink.messageId, input.messageId),
                );
                const row = db.select().from(jobMailLink).where(where).get();
                if (!row || input.messageId === input.resolvedMessageId) return;
                db.transaction((tx) => {
                  tx.insert(jobMailLink)
                    .values({ ...row, messageId: input.resolvedMessageId })
                    .onConflictDoNothing()
                    .run();
                  tx.delete(jobMailLink).where(where).run();
                });
              }),
            list: agentOrLoopbackProcedure.input(z.object({ key: z.string().min(1) })).query(({ input }) => {
              ready();
              return db.select().from(jobMailLink).where(eq(jobMailLink.key, input.key)).all();
            }),
            // Every linked mail, closed applications too: the stats read their threads for a received message.
            all: agentOrLoopbackProcedure.query(() => {
              ready();
              return db
                .select({ key: jobMailLink.key, account: jobMailLink.account, messageId: jobMailLink.messageId })
                .from(jobMailLink)
                .all();
            }),
            // Days from applying to the first invitation or rejection, computed here so no mail row reaches the page.
            firstResponse: agentOrLoopbackProcedure.query(() => {
              ready();
              const rows = db
                .select({
                  key: jobMailLink.key,
                  answer: mailChecked.answer,
                  receivedAt: mailChecked.receivedAt,
                  checkedAt: mailChecked.checkedAt,
                })
                .from(jobMailLink)
                .innerJoin(
                  mailChecked,
                  and(eq(mailChecked.account, jobMailLink.account), eq(mailChecked.messageId, jobMailLink.messageId)),
                )
                .where(eq(mailChecked.outcome, 'read'))
                .all();
              const answers = rows.flatMap((row) => {
                const parsed = mailAnswerSchema.safeParse(row.answer);
                const answered = parsed.success && (parsed.data.kind === 'invito' || parsed.data.kind === 'rifiuto');
                return answered ? [{ key: row.key, at: (row.receivedAt ?? row.checkedAt).getTime() }] : [];
              });
              const applications = db
                .select({ key: jobApplied.key, appliedAt: jobApplied.appliedAt })
                .from(jobApplied)
                .all()
                .map((app) => ({ key: app.key, appliedAt: app.appliedAt.getTime() }));
              return firstResponse(applications, answers);
            }),
            byApplications: agentOrLoopbackProcedure.query(() => {
              const profile = ready();
              const interviews = db
                .select({ key: jobInterview.key, scheduledAt: jobInterview.scheduledAt })
                .from(jobInterview)
                .all();
              const active = db
                .select()
                .from(jobApplied)
                .all()
                .filter(
                  (app) =>
                    app.closedAt === null &&
                    isActive(
                      effectiveApplicationStatus(
                        {
                          ...app,
                          appliedAt: app.appliedAt.getTime(),
                          interviews: interviews.filter((interview) => interview.key === app.key),
                        },
                        clock.now(),
                      ),
                    ),
                )
                .map((app) => app.key);
              const links = active.length
                ? db.select().from(jobMailLink).where(inArray(jobMailLink.key, active)).all()
                : [];
              return { links, waitingDays: profile.waitingDays };
            }),
            add: agentOrLoopbackProcedure
              .meta({ label: 'Collega mail', description: 'Link a message to an application.' })
              .input(
                z.object({
                  key: z.string().min(1),
                  account: z.string().min(1).max(60),
                  messageId: z.string().min(1).max(320),
                }),
              )
              .mutation(async ({ input }) => {
                ready();
                if (!db.select().from(jobApplied).where(eq(jobApplied.key, input.key)).get()) {
                  throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Posting has no application' });
                }
                db.insert(jobMailLink)
                  .values({ ...input, linkedAt: new Date(clock.now()) })
                  .onConflictDoNothing()
                  .run();
                if (
                  mail &&
                  (mailConfig?.accounts.includes(input.account) ||
                    mail.accounts().some((account) => account.account === input.account))
                ) {
                  try {
                    const listing = await mail.listThreadEntries(input.account, windowStart(60, new Date(clock.now())));
                    saveThreadAddresses(db, input.key, mail.threadOf(listing.entries, input.messageId), clock.now());
                  } catch {
                    /* The link stays valid when mail is unavailable. */
                  }
                }
                return { success: true };
              }),
            remove: agentOrLoopbackProcedure
              .meta({
                label: 'Scollega mail',
                description: 'Remove a message link from an application.',
                danger: true,
              })
              .input(
                z.object({
                  key: z.string().min(1),
                  account: z.string().min(1).max(60),
                  messageId: z.string().min(1).max(320),
                  confirmed: z.literal(true),
                }),
              )
              .mutation(({ input }) => {
                ready();
                db.delete(jobMailLink)
                  .where(
                    and(
                      eq(jobMailLink.key, input.key),
                      eq(jobMailLink.account, input.account),
                      eq(jobMailLink.messageId, input.messageId),
                    ),
                  )
                  .run();
                return { success: true };
              }),
          }),
          addInterview: agentOrLoopbackProcedure
            .meta({
              label: 'Aggiungi colloquio',
              description: 'Schedule an interview for an application.',
            })
            .input(
              z.object({
                key: z.string().min(1),
                scheduledAt: z.number().int().positive(),
                label: z.string().min(1).max(200),
              }),
            )
            .mutation(({ input }) => {
              ready();
              return db.transaction((tx) => scheduleInterview(tx, input));
            }),
          updateInterview: agentOrLoopbackProcedure
            .meta({
              label: 'Aggiorna colloquio',
              description: 'Update the date or label of a scheduled interview.',
            })
            .input(
              z.object({
                id: z.number().int().positive(),
                scheduledAt: z.number().int().positive().optional(),
                label: z.string().min(1).max(200).optional(),
              }),
            )
            .mutation(({ input }) => {
              ready();
              return db.transaction((tx) => {
                const existing = tx.select().from(jobInterview).where(eq(jobInterview.id, input.id)).get();
                if (!existing) {
                  throw new TRPCError({ code: 'NOT_FOUND', message: 'Interview not found' });
                }
                const updates: { scheduledAt?: Date; label?: string } = {};
                if (input.scheduledAt !== undefined) updates.scheduledAt = new Date(input.scheduledAt);
                if (input.label !== undefined) updates.label = input.label.trim();

                if (Object.keys(updates).length > 0) {
                  tx.update(jobInterview).set(updates).where(eq(jobInterview.id, input.id)).run();
                }
                return { success: true, id: input.id };
              });
            }),
          deleteInterview: agentOrLoopbackProcedure
            .meta({
              label: 'Elimina colloquio',
              description: 'Delete a scheduled interview.',
              danger: true,
            })
            .input(
              z.object({
                id: z.number().int().positive(),
                confirmed: z.literal(true),
              }),
            )
            .mutation(({ input }) => {
              ready();
              return db.transaction((tx) => {
                const res = tx.delete(jobInterview).where(eq(jobInterview.id, input.id)).run();
                if (res.changes === 0) {
                  throw new TRPCError({ code: 'NOT_FOUND', message: 'Interview not found' });
                }
                return { success: true, id: input.id };
              });
            }),
          importApplications: agentOrLoopbackProcedure
            .meta({
              label: 'Importa candidature',
              description: 'Import previously saved applications from a JSON file array.',
            })
            .input(
              z.object({
                fileId: z.string().min(1),
                dryRun: z.boolean().default(false),
              }),
            )
            .mutation(async ({ input, ctx }) => {
              forbidAgent(ctx);
              ready();
              const buffer = await ctx.files.read(input.fileId);
              let rawData: unknown;
              try {
                rawData = JSON.parse(Buffer.from(buffer).toString('utf-8'));
              } catch {
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'File is not valid JSON' });
              }
              if (!Array.isArray(rawData)) {
                throw new TRPCError({ code: 'BAD_REQUEST', message: 'Uploaded file must be a JSON array' });
              }

              const errors: Array<{ index: number; issue: string }> = [];
              type ValidImportRow = z.infer<typeof importedRowSchema>;
              const validRows: Array<{ index: number; row: ValidImportRow }> = [];

              for (let i = 0; i < rawData.length; i++) {
                const parsed = importedRowSchema.safeParse(rawData[i]);
                if (!parsed.success) {
                  const issue = parsed.error.issues
                    .map((iss) => `${iss.path.join('.') || 'row'}: ${iss.message}`)
                    .join('; ');
                  errors.push({ index: i, issue });
                } else {
                  validRows.push({ index: i, row: parsed.data });
                }
              }

              let created = 0;
              let skipped = 0;

              db.transaction((tx) => {
                const now = clock.now();
                const seenKeysInBatch = new Set<string>();

                for (const { row } of validRows) {
                  const postKey = postingKey(row.company, row.role);
                  const cmpKey = comparisonKey(row.company, row.role);

                  const rowUrl = row.url ? postingUrl(row.url) : null;
                  let matchedJob: { key: string; url: string } | null = null;
                  if (rowUrl) {
                    const byUrl = tx
                      .select({ key: jobs.key, url: jobs.url })
                      .from(jobs)
                      .where(eq(jobs.url, rowUrl))
                      .get();
                    if (byUrl) matchedJob = byUrl;
                  }
                  if (!matchedJob) {
                    const byCmp = tx
                      .select({ key: jobs.key, url: jobs.url })
                      .from(jobs)
                      .where(eq(jobs.comparisonKey, cmpKey))
                      .get();
                    if (byCmp) matchedJob = byCmp;
                  }
                  if (!matchedJob) {
                    const byKey = tx
                      .select({ key: jobs.key, url: jobs.url })
                      .from(jobs)
                      .where(eq(jobs.key, postKey))
                      .get();
                    if (byKey) matchedJob = byKey;
                  }

                  const targetKey = matchedJob?.key ?? postKey;

                  const existingApp = tx
                    .select({ key: jobApplied.key })
                    .from(jobApplied)
                    .where(eq(jobApplied.key, targetKey))
                    .get();

                  if (existingApp || seenKeysInBatch.has(targetKey)) {
                    skipped++;
                    continue;
                  }
                  seenKeysInBatch.add(targetKey);

                  if (!input.dryRun) {
                    if (!matchedJob) {
                      const finalUrl = rowUrl ?? `urn:import:${postKey}`;
                      const appliedDate = new Date(`${row.date}T00:00:00`);
                      tx.insert(jobs)
                        .values({
                          key: postKey,
                          comparisonKey: cmpKey,
                          title: row.role,
                          company: row.company,
                          location: row.remote ? 'Remoto' : '',
                          site: row.channel,
                          url: finalUrl,
                          applyUrl: null,
                          score: 0,
                          total: 0,
                          reasons: ['importata'],
                          categories: [],
                          description: null,
                          descriptionHtml: null,
                          workMode: row.remote ? 'remote' : null,
                          isRemote: row.remote === true,
                          detailsMissing: true,
                          postedAt: appliedDate,
                          firstSeen: appliedDate,
                          importedAt: new Date(now),
                          blacklistRule: null,
                        })
                        .run();
                    }

                    const statusMap: Record<ValidImportRow['status'], ApplicationStatus> = {
                      no_response: 'pending',
                      expired: 'expired',
                      rejected: 'rejected',
                      colloquio: 'interviewing',
                    };

                    let notes = row.notes ?? null;
                    if (row.date_estimated) {
                      notes = notes ? `${notes} (data stimata)` : 'data stimata';
                    }

                    const appliedAt = new Date(`${row.date}T00:00:00`);
                    const closedAt = row.closed ? new Date(`${row.closed}T00:00:00`) : null;

                    tx.insert(jobApplied)
                      .values({
                        key: targetKey,
                        appliedAt,
                        status: statusMap[row.status],
                        closedAt,
                        reason: null,
                        notes,
                      })
                      .run();

                    if (row.interviews && row.interviews.length > 0) {
                      for (const interview of row.interviews) {
                        // Local time, so the Calendario shows the day the file says; no time means local midnight.
                        const scheduledAt = interviewTimestamp(interview.date, interview.time ?? '00:00');
                        if (scheduledAt === null) continue;
                        tx.insert(jobInterview)
                          .values({
                            key: targetKey,
                            scheduledAt: new Date(scheduledAt),
                            label: interview.type,
                          })
                          .run();
                      }
                    }
                  }
                  created++;
                }
              });

              return { created, skipped, errors };
            }),
          rules: router({
            create: agentOrLoopbackProcedure
              .meta({
                label: 'Crea regola blacklist',
                description: 'Create a new blacklist rule to filter job postings.',
              })
              .input(
                z.object({
                  field: z.enum(blacklistFields),
                  matchType: z.enum(blacklistMatchTypes),
                  value: z.string().min(1),
                  note: z.string().default(''),
                  enabled: z.boolean().default(true),
                }),
              )
              .mutation(({ ctx, input }) => {
                forbidAgent(ctx);
                ready();
                const now = clock.now();
                const inserted = db
                  .insert(blacklistRules)
                  .values({
                    field: input.field,
                    matchType: input.matchType,
                    value: input.value.trim(),
                    note: input.note.trim(),
                    enabled: input.enabled,
                    createdAt: new Date(now),
                  })
                  .returning()
                  .get();
                if (!inserted) {
                  throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to insert rule' });
                }
                return {
                  id: inserted.id,
                  enabled: inserted.enabled,
                  field: inserted.field,
                  matchType: inserted.matchType,
                  value: inserted.value,
                  note: inserted.note,
                  createdAt: inserted.createdAt.getTime(),
                } satisfies RuleRow;
              }),
            update: agentOrLoopbackProcedure
              .meta({
                label: 'Aggiorna regola blacklist',
                description: 'Update an existing blacklist rule.',
              })
              .input(
                z.object({
                  id: z.number().int().positive(),
                  field: z.enum(blacklistFields).optional(),
                  matchType: z.enum(blacklistMatchTypes).optional(),
                  value: z.string().min(1).optional(),
                  note: z.string().optional(),
                  enabled: z.boolean().optional(),
                }),
              )
              .mutation(({ ctx, input }) => {
                forbidAgent(ctx);
                ready();
                return db.transaction((tx) => {
                  const existing = tx.select().from(blacklistRules).where(eq(blacklistRules.id, input.id)).get();
                  if (!existing) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found' });
                  }
                  const updates: {
                    field?: (typeof blacklistFields)[number];
                    matchType?: (typeof blacklistMatchTypes)[number];
                    value?: string;
                    note?: string;
                    enabled?: boolean;
                  } = {};
                  if (input.field !== undefined) updates.field = input.field;
                  if (input.matchType !== undefined) updates.matchType = input.matchType;
                  if (input.value !== undefined) updates.value = input.value.trim();
                  if (input.note !== undefined) updates.note = input.note.trim();
                  if (input.enabled !== undefined) updates.enabled = input.enabled;

                  let row = existing;
                  if (Object.keys(updates).length > 0) {
                    const res = tx
                      .update(blacklistRules)
                      .set(updates)
                      .where(eq(blacklistRules.id, input.id))
                      .returning()
                      .get();
                    if (res) row = res;
                  }
                  return {
                    id: row.id,
                    enabled: row.enabled,
                    field: row.field,
                    matchType: row.matchType,
                    value: row.value,
                    note: row.note,
                    createdAt: row.createdAt.getTime(),
                  } satisfies RuleRow;
                });
              }),
            delete: agentOrLoopbackProcedure
              .meta({
                label: 'Elimina regola blacklist',
                description: 'Delete an existing blacklist rule.',
                danger: true,
              })
              .input(
                z.object({
                  id: z.number().int().positive(),
                  confirmed: z.literal(true),
                }),
              )
              .mutation(({ input }) => {
                ready();
                return db.transaction((tx) => {
                  const existing = tx.select().from(blacklistRules).where(eq(blacklistRules.id, input.id)).get();
                  if (!existing) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found' });
                  }
                  tx.delete(blacklistRules).where(eq(blacklistRules.id, input.id)).run();
                  return {
                    id: existing.id,
                    enabled: existing.enabled,
                    field: existing.field,
                    matchType: existing.matchType,
                    value: existing.value,
                    note: existing.note,
                    createdAt: existing.createdAt.getTime(),
                  } satisfies RuleRow;
                });
              }),
            setEnabled: agentOrLoopbackProcedure
              .meta({
                label: 'Attiva o disattiva regola blacklist',
                description: 'Enable or disable an existing blacklist rule.',
              })
              .input(
                z.object({
                  id: z.number().int().positive(),
                  enabled: z.boolean(),
                }),
              )
              .mutation(({ ctx, input }) => {
                forbidAgent(ctx);
                ready();
                return db.transaction((tx) => {
                  const existing = tx.select().from(blacklistRules).where(eq(blacklistRules.id, input.id)).get();
                  if (!existing) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found' });
                  }
                  const updated = tx
                    .update(blacklistRules)
                    .set({ enabled: input.enabled })
                    .where(eq(blacklistRules.id, input.id))
                    .returning()
                    .get();
                  if (!updated) {
                    throw new TRPCError({ code: 'NOT_FOUND', message: 'Rule not found' });
                  }
                  return {
                    id: updated.id,
                    enabled: updated.enabled,
                    field: updated.field,
                    matchType: updated.matchType,
                    value: updated.value,
                    note: updated.note,
                    createdAt: updated.createdAt.getTime(),
                  } satisfies RuleRow;
                });
              }),
            include: agentOrLoopbackProcedure
              .meta({
                label: 'Includi di nuovo offerta',
                description:
                  'Remove a single-posting blacklist rule and clear the blacklist rule from the job posting.',
              })
              .input(
                z.object({
                  key: z.string().min(1),
                }),
              )
              .mutation(({ ctx, input }) => {
                forbidAgent(ctx);
                ready();
                return db.transaction((tx) => {
                  tx.delete(blacklistRules)
                    .where(and(eq(blacklistRules.field, 'key'), eq(blacklistRules.value, input.key)))
                    .run();
                  tx.update(jobs).set({ blacklistRule: null }).where(eq(jobs.key, input.key)).run();
                  return { success: true, key: input.key };
                });
              }),
          }),
          importRead: loopbackProcedure
            .meta({
              label: 'Leggi offerta da link',
              description: 'Fetch and parse a job posting from an external URL without saving it.',
              pageOnly: true,
            })
            .input(
              z.object({
                url: z.string().min(1),
              }),
            )
            .mutation(async ({ input }) => {
              const validProfile = ready();
              const workModeResolver = createWorkModeResolver(validProfile.patterns.workMode);
              return fetchAndParsePosting(input.url, cleaner, {
                fetch: effectiveFetch,
                lookup,
                workModeResolver,
              });
            }),
          refetchDescription: agentOrLoopbackProcedure
            .input(z.object({ key: z.string().min(1) }))
            .mutation(async ({ ctx, input }) => {
              forbidAgent(ctx);
              const validProfile = ready();
              const row = db.select().from(jobs).where(eq(jobs.key, input.key)).get();
              if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Annuncio non trovato' });
              const url = assertHttpUrl(row.url, 'url');

              let description = '';
              let descriptionHtml: string | null = null;
              const describe = registry.get(row.site)?.describe;
              if (!describe)
                throw new TRPCError({
                  code: 'BAD_REQUEST',
                  message: 'La sorgente non supporta il recupero della descrizione',
                });
              {
                const previous = descriptionTurn;
                let release = () => {};
                descriptionTurn = new Promise<void>((resolve) => {
                  release = resolve;
                });
                await previous;
                const controller = new AbortController();
                const sourceContext = {
                  signal: controller.signal,
                  fetch: async (input: string | URL | Request, init?: RequestInit) => {
                    const request = new Request(input, init);
                    const target = await assertPublicTarget(new URL(request.url), lookup);
                    if (request.method !== 'GET') throw new Error('Description requests must use GET');
                    if (effectiveFetch !== globalThis.fetch)
                      return effectiveFetch(request.url, { ...init, redirect: 'manual' });
                    const response = await pinnedRequest(new URL(request.url), target, {
                      headers: Object.fromEntries(request.headers),
                      signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
                      maxBytes: MAX_SCRAPER_BYTES,
                    });
                    return new Response(response.text, { status: response.status, headers: response.headers });
                  },
                  now: clock.now,
                  sleep: (ms: number) => clock.sleep(ms, controller.signal),
                  log,
                  isKnown: () => false,
                  limits: validProfile.search,
                  sources: validProfile.sources,
                  stable: validProfile.stable,
                };
                try {
                  if (row.site === 'linkedin' && descriptionNext > clock.now())
                    await clock.sleep(descriptionNext - clock.now(), controller.signal);
                  const result = await describe(
                    { url, title: row.title, company: row.company, location: row.location, site: row.site },
                    sourceContext,
                  );
                  if (typeof result === 'string') {
                    description = result.trim();
                  } else {
                    description = result.text.trim();
                    descriptionHtml = result.html.trim() || null;
                  }
                } catch {
                  throw new TRPCError({
                    code: 'BAD_GATEWAY',
                    message: "Non è stato possibile leggere il testo dall'annuncio",
                  });
                } finally {
                  if (row.site === 'linkedin')
                    descriptionNext = clock.now() + validProfile.search.linkedin.minIntervalSeconds * 1000;
                  release();
                }
              }

              if (!description) {
                throw new TRPCError({
                  code: 'BAD_GATEWAY',
                  message: "Non è stato possibile leggere il testo dall'annuncio",
                });
              }

              const scorer = createScorer(validProfile);
              const scored = scorer.score({
                title: row.title,
                company: row.company,
                location: row.location,
                site: row.site,
                description,
                declaredMode: row.workMode ?? undefined,
              });
              const categories = scorer.categories({
                title: row.title,
                company: row.company,
                site: row.site,
                description,
              });

              db.transaction(() => {
                db.update(jobs)
                  .set({
                    description,
                    descriptionHtml,
                    detailsMissing: false,
                    score: scored.score,
                    total: scored.total,
                    reasons: scored.reasons,
                    categories,
                    workMode: scored.workMode,
                    isRemote: scored.workMode === 'remote',
                  })
                  .where(eq(jobs.key, row.key))
                  .run();
              });

              return { updated: true, key: row.key };
            }),
          importSave: agentOrLoopbackProcedure
            .meta({
              label: 'Salva offerta importata',
              description: 'Save a manually imported job posting.',
            })
            .input(
              z.object({
                job: z.object({
                  title: z.string().min(1),
                  company: z.string().min(1),
                  url: z.string().min(1),
                  location: z.string().default(''),
                  site: z.string().default('import'),
                  applyUrl: z.string().nullable().optional(),
                  description: z.string().nullable().optional(),
                  descriptionHtml: z.string().nullable().optional(),
                  workMode: z.enum(['remote', 'hybrid', 'onsite']).nullable().optional(),
                  isRemote: z.boolean().default(false),
                  postedAt: z.number().int().positive().nullable().optional(),
                }),
              }),
            )
            .mutation(({ input }) => {
              ready();
              const rawUrl = assertHttpUrl(input.job.url, 'url');
              const url = assertHttpUrl(postingUrl(rawUrl), 'url');
              const trimmedApply = input.job.applyUrl?.trim() ?? '';
              const applyUrl = trimmedApply ? assertHttpUrl(trimmedApply, 'applyUrl') : null;
              return db.transaction((tx) => {
                const postKey = postingKey(input.job.company, input.job.title);
                const cmpKey = comparisonKey(input.job.company, input.job.title, input.job.location);

                const byKey = tx.select({ key: jobs.key }).from(jobs).where(eq(jobs.key, postKey)).get();
                const byUrl = tx.select({ key: jobs.key }).from(jobs).where(eq(jobs.url, url)).get();
                if (byKey || byUrl) {
                  const existingKey = byKey?.key ?? byUrl?.key ?? postKey;
                  // The client reads the key from the message.
                  throw new TRPCError({ code: 'CONFLICT', message: existingKey, cause: { existingKey } });
                }

                const raw = input.job.descriptionHtml ?? input.job.description ?? '';
                const cleaned = cleanHtml(cleaner, raw);
                const description = cleaned.text || input.job.description || null;
                const descriptionHtml = cleaned.html || null;
                const now = clock.now();

                tx.insert(jobs)
                  .values({
                    key: postKey,
                    comparisonKey: cmpKey,
                    title: input.job.title.trim(),
                    company: input.job.company.trim(),
                    location: input.job.location.trim(),
                    site: input.job.site.trim() || 'import',
                    url,
                    applyUrl,
                    score: 0,
                    total: 0,
                    reasons: ['importata a mano'],
                    categories: [],
                    description,
                    descriptionHtml,
                    workMode: input.job.workMode ?? null,
                    isRemote: input.job.isRemote || input.job.workMode === 'remote',
                    detailsMissing: false,
                    postedAt: input.job.postedAt ? new Date(input.job.postedAt) : null,
                    firstSeen: new Date(now),
                    importedAt: new Date(now),
                    blacklistRule: null,
                  })
                  .run();

                return { success: true, key: postKey };
              });
            }),
          edit: agentOrLoopbackProcedure
            .meta({
              label: 'Modifica offerta',
              description: 'Update the fields of an existing job posting.',
            })
            .input(
              z.object({
                key: z.string().min(1),
                job: z.object({
                  key: z.string().optional(),
                  title: z.string().min(1).optional(),
                  company: z.string().min(1).optional(),
                  location: z.string().optional(),
                  site: z.string().optional(),
                  url: z.string().min(1).optional(),
                  applyUrl: z.string().nullable().optional(),
                  score: z.number().optional(),
                  total: z.number().optional(),
                  reasons: z.array(z.string()).optional(),
                  categories: z.array(z.string()).optional(),
                  description: z.string().nullable().optional(),
                  descriptionHtml: z.string().nullable().optional(),
                  workMode: z.enum(['remote', 'hybrid', 'onsite']).nullable().optional(),
                  isRemote: z.boolean().optional(),
                  detailsMissing: z.boolean().optional(),
                  postedAt: z.number().int().positive().nullable().optional(),
                }),
              }),
            )
            .mutation(({ ctx, input }) => {
              forbidAgent(ctx);
              ready();
              return db.transaction((tx) => {
                const existing = tx.select().from(jobs).where(eq(jobs.key, input.key)).get();
                if (!existing) {
                  throw new TRPCError({ code: 'NOT_FOUND', message: 'Job posting not found' });
                }

                const updates: Partial<typeof jobs.$inferInsert> = {};
                if (input.job.title !== undefined) updates.title = input.job.title.trim();
                if (input.job.company !== undefined) updates.company = input.job.company.trim();
                if (
                  input.job.title !== undefined ||
                  input.job.company !== undefined ||
                  input.job.location !== undefined
                ) {
                  updates.comparisonKey = comparisonKey(
                    input.job.company !== undefined ? input.job.company.trim() : existing.company,
                    input.job.title !== undefined ? input.job.title.trim() : existing.title,
                    input.job.location !== undefined ? input.job.location.trim() : existing.location,
                  );
                }
                if (input.job.location !== undefined) updates.location = input.job.location.trim();
                if (input.job.site !== undefined) updates.site = input.job.site.trim();
                if (input.job.url !== undefined) updates.url = assertHttpUrl(input.job.url, 'url');
                if (input.job.applyUrl !== undefined) {
                  const trimmed = input.job.applyUrl ? input.job.applyUrl.trim() : '';
                  updates.applyUrl = trimmed ? assertHttpUrl(trimmed, 'applyUrl') : null;
                }
                if (input.job.score !== undefined) {
                  updates.score = input.job.score;
                  if (input.job.total === undefined) updates.total = input.job.score;
                }
                if (input.job.total !== undefined) {
                  updates.total = input.job.total;
                  if (input.job.score === undefined) updates.score = input.job.total;
                }
                if (input.job.reasons !== undefined) updates.reasons = input.job.reasons;
                if (input.job.categories !== undefined) updates.categories = input.job.categories;

                if (input.job.descriptionHtml !== undefined || input.job.description !== undefined) {
                  const raw = input.job.descriptionHtml ?? input.job.description ?? '';
                  const cleaned = cleanHtml(cleaner, raw);
                  updates.description = cleaned.text || null;
                  updates.descriptionHtml = cleaned.html || null;
                }

                if (input.job.workMode !== undefined) updates.workMode = input.job.workMode;
                if (input.job.isRemote !== undefined) updates.isRemote = input.job.isRemote;
                if (input.job.detailsMissing !== undefined) updates.detailsMissing = input.job.detailsMissing;
                if (input.job.postedAt !== undefined) {
                  updates.postedAt = input.job.postedAt ? new Date(input.job.postedAt) : null;
                }

                // The key NEVER changes - input.job.key is ignored.
                if (Object.keys(updates).length > 0) {
                  tx.update(jobs).set(updates).where(eq(jobs.key, input.key)).run();
                }

                return { success: true, key: input.key };
              });
            }),
        }),
        // A collection still running when the server stops is cancelled and awaited, so it never writes to a closed database.
        close: async () => {
          active?.controller.abort();
          pareriWork?.controller.abort();
          mailWork?.controller.abort();
          for (const timer of mailTimers) clearTimeout(timer);
          await active?.done;
          await pareriWork?.done;
          await mailWork?.done;
        },
      };
    },
  });
}

export default createLavoroModule({
  sources: [
    createIndeedSource(),
    createReteInformaticaSource(),
    createLinkedinSource(),
    createInpaSource(),
    createIrenSource(),
    createSuccessFactorsSource(),
    createOracleSource(),
    createAvatureSource(),
    createManpowerSource(),
    createWorkdaySource(),
    createSynergieSource(),
  ],
});
