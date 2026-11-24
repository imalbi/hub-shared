import type { DiscoveredDeps } from '../../apps/server/src/core/module.ts';
import type { Run } from '../../apps/server/src/core/exec.ts';
import type { llmGate } from '../../apps/server/src/core/llm-gate.ts';
import { z } from '../../apps/server/src/core/module.ts';
import { and, desc, eq, inArray, isNull } from '../../apps/server/src/core/module-db.ts';
import type { Db } from '../../apps/server/src/db/index.ts';
import { himalaya, messageViewSchema, plainTextOf, readArgs } from '../../apps/server/src/modules/mail/himalaya.ts';
import { listThreadEntries, windowStart } from '../../apps/server/src/modules/mail/router.ts';
import { threadOf, type ThreadEntry } from '../../apps/server/src/modules/mail/thread.ts';
import { localDay } from '../../apps/web/src/lib/day.ts';
import { isActive } from './applications.ts';
import type { Profile } from './config.ts';
import { comparisonCompany, plain } from './key.ts';
import {
  fetchMailAnswer,
  mailAnswerSchema,
  mailInput,
  noApplication,
  type MailAnswer,
  type MailCandidate,
} from './mail-prompt.ts';
import { opinionFailure } from './opinion-prompt.ts';
import {
  applicationAddress,
  jobApplied,
  jobInterview,
  jobMailLink,
  jobs,
  mailChecked,
  mailProposals,
} from './schema.ts';
import type { ApplicationStatus } from './schema.ts';

const MAX_CANDIDATES = 40;
const DEFAULT_TIME = '09:00';
const PROVIDER_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'msn.com',
  'libero.it',
  'virgilio.it',
  'alice.it',
  'tin.it',
  'tiscali.it',
  'fastwebnet.it',
  'proton.me',
  'protonmail.com',
  'pec.it',
  'legalmail.it',
  'arubapec.it',
  'postecert.it',
  'registerpec.it',
  'tim.it',
  'vodafone.it',
  'aol.com',
  'zoho.com',
  'mail.com',
  'fastmail.com',
]);
const FREE_MAIL_REGIONAL = /^(?:outlook|hotmail|live|yahoo|gmx|yandex)\.[a-z]{2,}(?:\.[a-z]{2,})?$/u;
const SECOND_LEVEL_TLDS = new Set(['co', 'com', 'org', 'net', 'gov', 'edu']);
const GENERIC_COMPANY_WORDS = new Set([
  'corp',
  'group',
  'tech',
  'systems',
  'solutions',
  'italia',
  'italy',
  'consulting',
  'services',
  'digital',
  'example',
  'company',
  'studio',
]);

export function isFreeMailDomain(domain: string) {
  const lower = domain.trim().toLowerCase();
  return PROVIDER_DOMAINS.has(lower) || FREE_MAIL_REGIONAL.test(lower);
}

export function domainEvidence(sender: string, addresses: readonly string[]) {
  const domain = sender.toLowerCase().trim().split('@')[1];
  return (
    !!domain &&
    !isFreeMailDomain(domain) &&
    addresses.some((address) => address.toLowerCase().trim().split('@')[1] === domain)
  );
}

/** True when a non-freemail sender's registrable domain matches the company's distinctive name or joined form. */
export function companyDomainEvidence(sender: string, company: string) {
  const domain = sender.toLowerCase().trim().split('@')[1] ?? '';
  if (!domain || !domain.includes('.') || isFreeMailDomain(domain)) return false;
  const parts = domain.split('.').filter(Boolean);
  const stripTldCount =
    parts.length >= 3 && SECOND_LEVEL_TLDS.has(parts.at(-2) ?? '') && (parts.at(-1)?.length ?? 0) === 2 ? 2 : 1;
  const orgLabel = (parts.slice(0, -stripTldCount).at(-1) ?? '').replaceAll('-', '');
  if (orgLabel.length < 3 || GENERIC_COMPANY_WORDS.has(orgLabel)) return false;

  const normalizedCompany = comparisonCompany(company);
  if (!normalizedCompany) return false;
  const companyWords = normalizedCompany
    .split(' ')
    .filter((word) => word.length >= 3 && !GENERIC_COMPANY_WORDS.has(word));
  const companyJoined = normalizedCompany.replaceAll(' ', '');
  if (companyJoined.length >= 3 && orgLabel === companyJoined) return true;
  return companyWords.includes(orgLabel);
}

export function canAutoLinkSender(sender: string, company: string, confirmedAddresses: readonly string[]) {
  return domainEvidence(sender, confirmedAddresses) || companyDomainEvidence(sender, company);
}

export type MailCheckState = { running: boolean; done: number; remaining: number; reason: string | null; date: number };
export type MailCheckResult = { checked: number; linked: number; suggested: number; proposed: number };
type Candidate = MailCandidate & { key: string };

/** Whether the company named by an application appears, as whole words, in the text of the mail. */
export function companyEvidence(company: string, text: string) {
  const name = comparisonCompany(company);
  return name.length > 0 && ` ${plain(text)} `.includes(` ${name} `);
}

/** Local date and time to a timestamp; null for a date that does not exist (the model can write 2026-02-31). */
export function interviewTimestamp(date: string, time: string) {
  const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
  const [hours = 0, minutes = 0] = (time || DEFAULT_TIME).split(':').map(Number);
  const at = new Date(year, month - 1, day, hours, minutes);
  const valid =
    at.getFullYear() === year && at.getMonth() === month - 1 && at.getDate() === day && hours < 24 && minutes < 60;
  return valid ? at.getTime() : null;
}

/** Comparator for the queue: newest first, a missing or unreadable date last. */
export function newestFirst(a: string | null, b: string | null) {
  const time = (date: string | null) => {
    const parsed = Date.parse(date ?? '');
    return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
  };
  // Subtracting two -Infinity is NaN, which a sort treats unpredictably: compare instead.
  return time(a) === time(b) ? 0 : time(b) > time(a) ? 1 : -1;
}

/** The first message the owner sent in this thread after `receivedAt`, or null: an earlier one is the application itself. */
export function repliedAt(
  thread: { messages: readonly Pick<ThreadEntry, 'mailbox' | 'date'>[] } | null,
  receivedAt: number,
) {
  const times = (thread?.messages ?? [])
    .filter((message) => message.mailbox === 'sent' && message.date)
    .map((message) => Date.parse(message.date ?? ''))
    .filter((time) => time > receivedAt);
  return times.length > 0 ? Math.min(...times) : null;
}

/** Stamps `answeredAt` on the open "Da fare" items of an account whose thread holds a later sent message. */
function markAnswered(db: Db, account: string, entries: readonly ThreadEntry[], todoDays: number, now: number) {
  const open = db
    .select()
    .from(mailChecked)
    .where(
      and(
        eq(mailChecked.account, account),
        eq(mailChecked.outcome, 'read'),
        isNull(mailChecked.dismissedAt),
        isNull(mailChecked.answeredAt),
      ),
    )
    .all();
  for (const row of open) {
    const received = (row.receivedAt ?? row.checkedAt).getTime();
    const parsed = mailAnswerSchema.safeParse(row.answer);
    if (received < now - todoDays * 86_400_000 || !parsed.success || !parsed.data.ask.trim()) continue;
    const at = repliedAt(threadOf(entries, row.messageId), received);
    if (at !== null)
      db.update(mailChecked)
        .set({ answeredAt: new Date(at) })
        .where(eq(mailChecked.id, row.id))
        .run();
  }
}

export type FollowUps = { status: ApplicationStatus | null; interview: { scheduledAt: number; label: string } | null };

/**
 * What an answer proposes on an application: a rejection proposes `rejected`; an invitation with a real date proposes the
 * interview (adding one moves a pending application to interviewing), an invitation without one proposes `interviewing`.
 */
export function followUps(answer: MailAnswer, current: ApplicationStatus, hasInterviewAt: (at: number) => boolean) {
  const none: FollowUps = { status: null, interview: null };
  if (answer.kind === 'rifiuto') return current === 'rejected' ? none : { ...none, status: 'rejected' as const };
  if (answer.kind !== 'invito') return none;
  const at = answer.interviewDate ? interviewTimestamp(answer.interviewDate, answer.interviewTime) : null;
  if (at === null) return current === 'interviewing' ? none : { ...none, status: 'interviewing' as const };
  if (hasInterviewAt(at)) return none;
  const place = answer.interviewPlace.replace(/\s+/g, ' ').trim();
  const hint = answer.interviewTime ? '' : ' (orario da definire)';
  return {
    ...none,
    interview: { scheduledAt: at, label: `Colloquio${place ? `, ${place}` : ''}${hint}`.slice(0, 200) },
  };
}

export type Decision = { link: string | null; suggest: string | null; application: string | null };

/**
 * Confident means the model says `alta`, the application's company appears in the mail text, and nothing else owns the
 * thread; anything the model rates `media`, or `alta` without that evidence, is a suggestion. `bassa` is dropped.
 */
export function decide(
  answer: MailAnswer,
  candidates: readonly Candidate[],
  context: { linkedKey: string | null; evidence: (candidate: Candidate) => boolean },
): Decision {
  const nothing = { link: null, suggest: null, application: null };
  if (context.linkedKey) return { link: null, suggest: null, application: context.linkedKey };
  if (answer.application === noApplication || answer.confidence === 'bassa') return nothing;
  const chosen = candidates.find((candidate) => candidate.id === answer.application);
  if (!chosen) return nothing;
  if (answer.confidence === 'alta' && context.evidence(chosen))
    return { link: chosen.key, suggest: null, application: chosen.key };
  return { link: null, suggest: chosen.key, application: null };
}

export function openCandidates(db: Db, limit = MAX_CANDIDATES): Candidate[] {
  const rows = db
    .select({
      key: jobApplied.key,
      status: jobApplied.status,
      appliedAt: jobApplied.appliedAt,
      company: jobs.company,
      title: jobs.title,
    })
    .from(jobApplied)
    .innerJoin(jobs, eq(jobs.key, jobApplied.key))
    .where(isNull(jobApplied.closedAt))
    .orderBy(desc(jobApplied.appliedAt))
    .all()
    .filter((row) => isActive(row.status));
  return rows.slice(0, limit).map((row, index) => ({
    id: `A${index + 1}`,
    key: row.key,
    company: row.company,
    title: row.title,
    appliedOn: localDay(row.appliedAt),
    status: row.status,
  }));
}

/** Inserts the proposals an answer asks for on one application; a proposal already made (or resolved) is never repeated. */
export function proposeFollowUps(
  db: Pick<Db, 'select' | 'insert'>,
  args: { key: string; account: string; messageId: string; subject: string; answer: MailAnswer; now: number },
) {
  const app = db.select().from(jobApplied).where(eq(jobApplied.key, args.key)).get();
  if (!app) return 0;
  const interviews = db.select().from(jobInterview).where(eq(jobInterview.key, args.key)).all();
  const wanted = followUps(args.answer, app.status, (at) => interviews.some((i) => i.scheduledAt.getTime() === at));
  const base = {
    key: args.key,
    account: args.account,
    messageId: args.messageId,
    subject: args.subject,
    why: args.answer.why,
    createdAt: new Date(args.now),
  };
  let added = 0;
  if (wanted.status) {
    added += Number(
      db
        .insert(mailProposals)
        .values({ ...base, kind: 'status', status: wanted.status })
        .onConflictDoNothing()
        .run().changes,
    );
  }
  if (wanted.interview) {
    added += Number(
      db
        .insert(mailProposals)
        .values({
          ...base,
          kind: 'interview',
          scheduledAt: new Date(wanted.interview.scheduledAt),
          label: wanted.interview.label,
        })
        .onConflictDoNothing()
        .run().changes,
    );
  }
  return added;
}

type Deps = {
  db: Db;
  run: Run;
  fetch: typeof fetch;
  gate: typeof llmGate;
  log: DiscoveredDeps['log'];
  now: () => number;
  config: Profile['mailCheck'];
};

async function bodyOf(run: Run, account: string, id: string) {
  const result = await himalaya(run, readArgs(account, 'INBOX', id), messageViewSchema);
  return result.ok ? plainTextOf(result.value) : null;
}

export function saveThreadAddresses(
  db: Pick<Db, 'insert'>,
  key: string,
  entries: readonly ThreadEntry[],
  messageId: string,
  now: number,
) {
  for (const message of threadOf(entries, messageId)?.messages ?? []) {
    const address = message.counterpart?.toLowerCase();
    if (address && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))
      db.insert(applicationAddress)
        .values({ key, address, origin: 'thread', addedAt: new Date(now) })
        .onConflictDoNothing()
        .run();
  }
}

/** The application that already owns a conversation: a link on any message of the same thread, if there is exactly one. */
function linkedCandidate(
  db: Db,
  account: string,
  entries: readonly ThreadEntry[],
  messageId: string,
  all: Candidate[],
) {
  const ids = threadOf(entries, messageId)?.messages.flatMap((m) => (m.messageId ? [m.messageId] : [])) ?? [];
  if (ids.length === 0) return null;
  const owners = new Set(
    db
      .select({ key: jobMailLink.key })
      .from(jobMailLink)
      .where(and(eq(jobMailLink.account, account), inArray(jobMailLink.messageId, ids)))
      .all()
      .map((row) => row.key),
  );
  const [only] = [...owners];
  return owners.size === 1 ? (all.find((candidate) => candidate.key === only) ?? null) : null;
}

const isBadAnswer = (error: unknown) => error instanceof z.ZodError || error instanceof SyntaxError;

/**
 * Reads the received mail of the configured accounts that no earlier run read, newest first, up to `maxPerRun`. Every
 * call goes through the gate to Ollama (`fetchMailAnswer`); a provider failure stops the run and leaves the rest
 * unread for the next one. Logs carry reason codes only, never a subject, an address or a body.
 */
export async function runMailCheck(
  deps: Deps,
  signal: AbortSignal,
  onProgress: (progress: { done: number; remaining: number }) => void,
): Promise<MailCheckResult & { reason: string | null }> {
  const { db, run, config } = deps;
  const result = { checked: 0, linked: 0, suggested: 0, proposed: 0, reason: null as string | null };
  const after = windowStart(config.windowDays, new Date(deps.now()));
  const allCandidates = openCandidates(db, Number.MAX_SAFE_INTEGER);
  const baseCandidates = allCandidates.slice(0, MAX_CANDIDATES);
  const addresses = db
    .select({
      key: applicationAddress.key,
      address: applicationAddress.address,
      company: jobs.company,
      status: jobApplied.status,
      closedAt: jobApplied.closedAt,
    })
    .from(applicationAddress)
    .innerJoin(jobApplied, eq(jobApplied.key, applicationAddress.key))
    .innerJoin(jobs, eq(jobs.key, applicationAddress.key))
    .all()
    .filter((row) => !row.closedAt && isActive(row.status));
  const listings = new Map<string, ThreadEntry[]>();
  const queue: { account: string; entry: ThreadEntry; entries: ThreadEntry[] }[] = [];
  for (const account of config.accounts) {
    let listing;
    try {
      listing = await listThreadEntries(run, account, after);
    } catch {
      result.reason = 'account di posta non raggiungibile';
      continue;
    }
    listings.set(account, listing.entries);
    const seen = new Set(
      db
        .select({ id: mailChecked.messageId })
        .from(mailChecked)
        .where(eq(mailChecked.account, account))
        .all()
        .map((row) => row.id),
    );
    for (const entry of listing.entries) {
      if (entry.mailbox === 'inbox' && entry.messageId && !seen.has(entry.messageId))
        queue.push({ account, entry, entries: listing.entries });
    }
  }
  queue.sort((a, b) => newestFirst(a.entry.date, b.entry.date));
  const batch = queue.slice(0, config.maxPerRun);
  onProgress({ done: 0, remaining: batch.length });

  for (const [index, { account, entry, entries }] of batch.entries()) {
    if (signal.aborted) break;
    const messageId = entry.messageId ?? '';
    const linked = linkedCandidate(db, account, entries, messageId, allCandidates);
    const threadIds =
      threadOf(entries, messageId)?.messages.flatMap((message) => (message.messageId ? [message.messageId] : [])) ?? [];
    const alreadyOwned =
      threadIds.length > 0 &&
      !!db
        .select()
        .from(jobMailLink)
        .where(and(eq(jobMailLink.account, account), inArray(jobMailLink.messageId, threadIds)))
        .get();
    const owners = new Set(
      addresses.filter((row) => row.address === entry.counterpart?.toLowerCase()).map((row) => row.key),
    );
    const [owner] = [...owners];
    const matched =
      !alreadyOwned && owners.size === 1 ? allCandidates.find((candidate) => candidate.key === owner) : undefined;
    if (matched) {
      const inserted = db
        .insert(jobMailLink)
        .values({ key: matched.key, account, messageId, linkedAt: new Date(deps.now()), linkReason: 'address' })
        .onConflictDoNothing()
        .run();
      result.linked += Number(inserted.changes);
      saveThreadAddresses(db, matched.key, entries, messageId, deps.now());
    }
    const body = await bodyOf(run, account, entry.id);
    // An unreadable body is retried by the next run: it is not recorded as checked.
    if (body === null) continue;
    const selected = linked ?? matched;
    const candidates =
      selected && !baseCandidates.some((candidate) => candidate.key === selected.key)
        ? [...baseCandidates.slice(0, MAX_CANDIDATES - 1), selected]
        : baseCandidates;
    const input = mailInput(
      config.model,
      { from: entry.counterpart ?? '', date: entry.date ?? '', subject: entry.subject, body },
      candidates,
      linked?.id ?? matched?.id ?? null,
    );
    const stored = {
      account,
      messageId,
      subject: entry.subject.slice(0, 300),
      sender: entry.counterpart ?? '',
      receivedAt: entry.date ? new Date(entry.date) : null,
      checkedAt: new Date(deps.now()),
    };
    let answer: MailAnswer;
    try {
      // Uncounted: the daily cap belongs to the Parere; this run is bounded by `maxPerRun` and by what is new.
      answer = await deps.gate(
        Number.POSITIVE_INFINITY,
        (gateSignal) => fetchMailAnswer(deps.fetch, input, AbortSignal.any([signal, gateSignal]), new Date(deps.now())),
        { counted: false },
      );
    } catch (error) {
      if (signal.aborted) break;
      if (!isBadAnswer(error)) {
        result.reason = opinionFailure(error);
        deps.log.warn({ reason: result.reason }, 'Mail check stopped');
        break;
      }
      deps.log.warn({ reason: opinionFailure(error) }, 'Mail check answer unusable');
      db.insert(mailChecked)
        .values({ ...stored, outcome: 'invalid', answer: null })
        .onConflictDoNothing()
        .run();
      result.checked++;
      onProgress({ done: index + 1, remaining: batch.length - index - 1 });
      continue;
    }
    const text = `${entry.counterpart ?? ''} ${entry.subject} ${body}`;
    const decision = decide(answer, candidates, {
      linkedKey: linked?.key ?? matched?.key ?? null,
      evidence: (candidate) => {
        const companyNormalized = comparisonCompany(candidate.company);
        const confirmedAddresses = addresses
          .filter(
            (row) =>
              row.key === candidate.key ||
              (companyNormalized.length > 0 && comparisonCompany(row.company) === companyNormalized),
          )
          .map((row) => row.address);
        const sender = entry.counterpart ?? '';
        return (
          domainEvidence(sender, confirmedAddresses) ||
          (companyDomainEvidence(sender, candidate.company) && companyEvidence(candidate.company, text))
        );
      },
    });
    db.transaction((tx) => {
      tx.insert(mailChecked)
        .values({ ...stored, outcome: 'read', answer })
        .onConflictDoNothing()
        .run();
      result.checked++;
      if (decision.link) {
        // Never persist model-discovered thread addresses until the owner explicitly accepts or manually links.
        tx.insert(jobMailLink)
          .values({ key: decision.link, account, messageId, linkedAt: new Date(deps.now()), linkReason: 'model' })
          .onConflictDoNothing()
          .run();
        result.linked++;
      }
      if (decision.suggest) {
        result.suggested += Number(
          tx
            .insert(mailProposals)
            .values({
              kind: 'link',
              key: decision.suggest,
              account,
              messageId,
              subject: stored.subject,
              why: answer.why,
              createdAt: new Date(deps.now()),
            })
            .onConflictDoNothing()
            .run().changes,
        );
      }
      if (decision.application)
        result.proposed += proposeFollowUps(tx, {
          key: decision.application,
          account,
          messageId,
          subject: stored.subject,
          answer,
          now: deps.now(),
        });
    });
    onProgress({ done: index + 1, remaining: batch.length - index - 1 });
  }
  // Also when nothing new arrived: a reply the owner sent since the last run takes its item out of Oggi.
  for (const [account, entries] of listings) markAnswered(db, account, entries, config.todoDays, deps.now());
  return result;
}
