import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { MailCapability, MailThreadEntry } from '../../apps/server/src/core/module.ts';
import { createLlmGate } from '../../apps/server/src/core/llm-gate.ts';
import { openDatabase } from '../../apps/server/src/db/index.ts';
import type { Profile } from './config.ts';
import {
  canAutoLinkSender,
  companyDomainEvidence,
  companyEvidence,
  domainEvidence,
  decide,
  followUps,
  interviewTimestamp,
  isFreeMailDomain,
  newestFirst,
  openCandidates,
  repliedAt,
  runMailCheck,
  type MailCheckResult,
} from './mail-check.ts';
import type { MailAnswer } from './mail-prompt.ts';
import { ollamaUrl } from './opinion-prompt.ts';
import {
  applicationAddress,
  jobApplied,
  jobInterview,
  jobMailLink,
  jobs,
  mailChecked,
  mailProposals,
} from './schema.ts';
import { capturingLog } from './harness.ts';

const migrations = fileURLToPath(new URL('./drizzle', import.meta.url));
const now = Date.UTC(2026, 10, 10, 9, 0, 0);
const answer = (patch: Partial<MailAnswer> = {}): MailAnswer => ({
  application: 'nessuna',
  confidence: 'bassa',
  kind: 'altro',
  why: 'Motivo di prova',
  interviewDate: '',
  interviewTime: '',
  interviewPlace: '',
  ask: '',
  deadline: '',
  ...patch,
});
const candidate = (id: string, key: string, company: string) => ({
  id,
  key,
  company,
  title: 'Sviluppatore',
  appliedOn: '2026-11-01',
  status: 'pending',
});

void test('company evidence needs the whole name as words, accents and legal forms aside', () => {
  assert.equal(companyEvidence('Acme Corp S.r.l.', 'Gentile candidato, da Acme Corp'), true);
  assert.equal(companyEvidence('Società Esempio S.p.A.', 'dalla societa esempio'), true);
  assert.equal(companyEvidence('Acme', 'academy acmeology'), false);
  assert.equal(companyEvidence('Next Wave', 'next and wave'), false);
  assert.equal(companyEvidence('', 'anything'), false);
});

void test('a company domain supports a confident match, a shared mail provider does not', () => {
  assert.equal(domainEvidence('hr@acme.example', ['jobs@acme.example']), true); // guard-private: allow Synthetic fixture address
  assert.equal(domainEvidence('hr@gmail.com', ['jobs@gmail.com']), false); // guard-private: allow Synthetic fixture address
  assert.equal(domainEvidence('hr@else.example', ['jobs@acme.example']), false); // guard-private: allow Synthetic fixture address
  assert.equal(isFreeMailDomain('outlook.it'), true);
  assert.equal(isFreeMailDomain('pec.it'), true);
  assert.equal(isFreeMailDomain('proton.me'), true);
  assert.equal(companyDomainEvidence('hr@careers.acme.it', 'Acme Corp'), true); // guard-private: allow Synthetic fixture address
  assert.equal(companyDomainEvidence('hr@gmail.com', 'Acme Corp'), false); // guard-private: allow Synthetic fixture address
  assert.equal(companyDomainEvidence('hr@unknown.example', 'Acme Corp'), false); // guard-private: allow Synthetic fixture address
  assert.equal(companyDomainEvidence('hr@evil-acme.example', 'Acme Corp'), false); // guard-private: allow Synthetic fixture address
  assert.equal(canAutoLinkSender('hr@gmail.com', 'Acme Corp', ['jobs@gmail.com']), false); // guard-private: allow Synthetic fixture address
  assert.equal(canAutoLinkSender('hr@acme.example', 'Acme Corp', []), true); // guard-private: allow Synthetic fixture address
});

void test('an interview time is a real local date, 09:00 when the mail gives none', () => {
  assert.equal(interviewTimestamp('2026-11-20', '15:30'), new Date(2026, 10, 20, 15, 30).getTime());
  assert.equal(interviewTimestamp('2026-11-20', ''), new Date(2026, 10, 20, 9, 0).getTime());
  assert.equal(interviewTimestamp('2026-02-31', '10:00'), null);
  assert.equal(interviewTimestamp('2026-11-20', '25:00'), null);
});

void test('follow-ups: a rejection proposes rejected, an invitation an interview or interviewing, other mail nothing', () => {
  const nothingAt = () => false;
  assert.deepEqual(followUps(answer({ kind: 'rifiuto' }), 'pending', nothingAt), {
    status: 'rejected',
    interview: null,
  });
  assert.deepEqual(followUps(answer({ kind: 'rifiuto' }), 'rejected', nothingAt), { status: null, interview: null });
  assert.deepEqual(followUps(answer({ kind: 'invito' }), 'pending', nothingAt), {
    status: 'interviewing',
    interview: null,
  });
  assert.deepEqual(followUps(answer({ kind: 'invito' }), 'interviewing', nothingAt), { status: null, interview: null });
  const dated = answer({
    kind: 'invito',
    interviewDate: '2026-11-20',
    interviewTime: '15:30',
    interviewPlace: ' https://meet.example.org/x ',
  });
  assert.deepEqual(followUps(dated, 'pending', nothingAt), {
    status: null,
    interview: {
      scheduledAt: new Date(2026, 10, 20, 15, 30).getTime(),
      label: 'Colloquio, https://meet.example.org/x',
    },
  });
  assert.equal(followUps(dated, 'pending', () => true).interview, null);
  const noTime = followUps(answer({ kind: 'invito', interviewDate: '2026-11-20' }), 'pending', nothingAt);
  assert.equal(noTime.interview?.label, 'Colloquio (orario da definire)');
  assert.deepEqual(followUps(answer({ kind: 'altro', ask: 'Rispondi' }), 'pending', nothingAt), {
    status: null,
    interview: null,
  });
});

void test('decide links only a confident, evidenced match and suggests the rest', () => {
  const list = [candidate('A1', 'k1', 'Acme'), candidate('A2', 'k2', 'Beta')];
  const evidence = { linkedKey: null, evidence: () => true };
  assert.deepEqual(decide(answer({ application: 'A2', confidence: 'alta' }), list, evidence), {
    link: 'k2',
    suggest: null,
    application: 'k2',
  });
  assert.deepEqual(
    decide(answer({ application: 'A2', confidence: 'alta' }), list, { ...evidence, evidence: () => false }),
    {
      link: null,
      suggest: 'k2',
      application: null,
    },
  );
  assert.deepEqual(decide(answer({ application: 'A1', confidence: 'media' }), list, evidence), {
    link: null,
    suggest: 'k1',
    application: null,
  });
  const nothing = { link: null, suggest: null, application: null };
  assert.deepEqual(decide(answer({ application: 'A1', confidence: 'bassa' }), list, evidence), nothing);
  assert.deepEqual(decide(answer({ application: 'nessuna', confidence: 'alta' }), list, evidence), nothing);
  assert.deepEqual(decide(answer({ application: 'A9', confidence: 'alta' }), list, evidence), nothing);
  // An application that already owns the thread wins over whatever the model picks, and is never linked twice.
  assert.deepEqual(decide(answer({ application: 'A2', confidence: 'bassa' }), list, { ...evidence, linkedKey: 'k1' }), {
    link: null,
    suggest: null,
    application: 'k1',
  });
});

// Synthetic `work` mailbox matching the shared fake mail fixture: inbox 310 (invitation), 309 (newsletter), 308 (reply
// to sent 42); sent 43 answers 310. Bodies and senders are overridden per test without spawning external commands.
function fakeThreadOf(entries: readonly MailThreadEntry[], messageId: string) {
  const start = entries.find((e) => e.messageId === messageId || e.id === messageId);
  if (!start) return null;
  const byId = new Map<string, MailThreadEntry>();
  for (const e of entries) if (e.messageId) byId.set(e.messageId, e);
  const group = new Set<MailThreadEntry>([start]);
  let growing = true;
  while (growing) {
    growing = false;
    for (const e of entries) {
      if (group.has(e)) continue;
      const connected =
        e.inReplyTo.some((id) => [...group].some((g) => g.messageId === id)) ||
        [...group].some((g) => g.inReplyTo.includes(e.messageId ?? ''));
      if (connected) {
        group.add(e);
        growing = true;
      }
    }
  }
  const messages = [...group].toSorted((a, b) => Date.parse(a.date ?? '') - Date.parse(b.date ?? ''));
  const latest = messages.at(-1);
  return {
    messageId: start.messageId ?? start.id,
    key: messages[0]?.messageId ?? start.id,
    waiting: latest?.mailbox === 'sent',
    messages,
  };
}

function fakeMailCapability(
  bodies: Record<string, string>,
  calls: string[][] = [],
  replaceSender?: string,
): MailCapability {
  const sender = (addr: string) => (replaceSender && addr === 'recruiter@example.org' ? replaceSender : addr);
  const baseEntries: MailThreadEntry[] = [
    {
      mailbox: 'inbox',
      id: '310',
      messageId: 'offer@example.org',
      inReplyTo: [],
      subject: 'Offerta di colloquio',
      date: '2026-11-07T09:00:00Z',
      counterpart: sender('recruiter@example.org'),
    },
    {
      mailbox: 'inbox',
      id: '309',
      messageId: 'news@example.org',
      inReplyTo: [],
      subject: 'Newsletter di prova',
      date: '2026-11-06T12:00:00Z',
      counterpart: 'news@example.org',
    },
    {
      mailbox: 'inbox',
      id: '308',
      messageId: 'reply@example.org',
      inReplyTo: ['sent42@example.org'],
      subject: 'Re: Domanda sul ruolo',
      date: '2026-11-05T15:00:00Z',
      counterpart: 'carla@example.org',
    },
    {
      mailbox: 'sent',
      id: '43',
      messageId: 'followup@example.org',
      inReplyTo: ['offer@example.org'],
      subject: 'Re: Offerta di colloquio',
      date: '2026-11-07T14:00:00Z',
      counterpart: sender('recruiter@example.org'),
    },
    {
      mailbox: 'sent',
      id: '42',
      messageId: 'sent42@example.org',
      inReplyTo: [],
      subject: 'Domanda sul ruolo',
      date: '2026-11-04T10:00:00Z',
      counterpart: 'carla@example.org',
    },
  ];
  const defaultBodies: Record<string, string> = {
    '310': 'Buongiorno, vorremmo proporle un colloquio.',
    '309': 'Novità settimanali.',
    '308': 'Grazie della risposta.',
    '43': 'Grazie mille, confermo.',
    '42': 'Quali sono i prossimi passi?',
  };
  return {
    accounts: () => [{ label: 'Work', account: 'work' }],
    async listThreadEntries(account) {
      calls.push(['listThreadEntries', account]);
      return { entries: baseEntries, truncated: false };
    },
    async readMessageText(account, _mailbox, id) {
      calls.push(['readMessageText', account, id]);
      return bodies[id] ?? defaultBodies[id] ?? null;
    },
    threadOf: fakeThreadOf,
  };
}

type Setup = {
  answers?: Record<string, Partial<MailAnswer> | 'invalid' | 'down'>;
  bodies?: Record<string, string>;
  config?: Partial<Profile['mailCheck']>;
  sender?: string;
};

function setup({ answers = {}, bodies = {}, config = {}, sender }: Setup = {}) {
  const db = openDatabase(':memory:', migrations);
  const requests: { url: string; prompt: string }[] = [];
  const gateCalls: ({ counted?: boolean } | undefined)[] = [];
  const gate = createLlmGate();
  const spyGate: typeof gate = Object.assign(
    <T>(cap: number, call: (signal: AbortSignal) => Promise<T>, options?: { counted?: boolean }) => {
      gateCalls.push(options);
      return gate(cap, call, options);
    },
    { used: gate.used },
  );
  const fetcher: typeof fetch = async (url, init) => {
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '');
    const prompt: string = body.messages[0].content;
    requests.push({ url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url, prompt });
    const subject = Object.keys(answers).find((s) => prompt.includes(`Oggetto: ${s}\n`));
    const planned = subject ? answers[subject] : undefined;
    if (planned === 'down') return new Response('internal', { status: 500 });
    const content = planned === 'invalid' ? 'not json' : JSON.stringify(answer(planned));
    return Response.json({ message: { content } });
  };
  const mailCalls: string[][] = [];
  const { log, records } = capturingLog();
  const deps = {
    db,
    mail: fakeMailCapability(bodies, mailCalls, sender),
    fetch: fetcher,
    gate: spyGate,
    log,
    now: () => now,
    config: {
      accounts: ['work'],
      model: 'gemma-test',
      windowDays: 30,
      maxPerRun: 20,
      todoDays: 7,
      auto: false,
      ...config,
    },
  };
  const run = (): Promise<MailCheckResult & { reason: string | null }> =>
    runMailCheck(deps, new AbortController().signal, () => undefined);
  return { db, deps, run, requests, gateCalls, gate, records, mailCalls };
}

function addApplication(
  db: ReturnType<typeof setup>['db'],
  key: string,
  company: string,
  extra: { status?: 'pending' | 'interviewing' | 'rejected'; closedAt?: number; appliedAt?: number } = {},
) {
  db.insert(jobs)
    .values({
      key,
      comparisonKey: key,
      title: 'Sviluppatore web',
      company,
      location: 'Examplia',
      site: 'indeed',
      url: `https://example.org/${key}`,
      score: 1,
      total: 1,
      reasons: [],
      categories: [],
      isRemote: false,
      detailsMissing: false,
      firstSeen: new Date(now),
    })
    .run();
  db.insert(jobApplied)
    .values({
      key,
      appliedAt: new Date(extra.appliedAt ?? Date.UTC(2026, 10, 1)),
      status: extra.status ?? 'pending',
      closedAt: extra.closedAt ? new Date(extra.closedAt) : null,
    })
    .run();
}

const links = (db: ReturnType<typeof setup>['db']) => db.select().from(jobMailLink).all();

void test('a known sender links Rossi ASD even when the model answers none', async () => {
  const s = setup({
    bodies: { '310': 'Pedala propone una chiamata.' },
    config: { maxPerRun: 1 },
    sender: 'info@pedala.example', // guard-private: allow Synthetic fixture address
  });
  addApplication(s.db, 'rossi', 'Rossi ASD');
  s.db
    .insert(applicationAddress)
    .values({ key: 'rossi', address: 'info@pedala.example', origin: 'sent', addedAt: new Date(now) }) // guard-private: allow Synthetic fixture address
    .run();
  const result = await s.run();
  assert.equal(result.linked, 1);
  assert.equal(links(s.db)[0]?.key, 'rossi');
  assert.equal(links(s.db)[0]?.linkReason, 'address');
  assert.ok(s.requests[0]?.prompt.includes('già collegata alla candidatura A1'));
});

void test('a confident model match links when the corporate domain matches', async () => {
  const s = setup({
    answers: { 'Offerta di colloquio': { application: 'A1', confidence: 'alta' } },
    config: { maxPerRun: 1 },
    sender: 'hr@acme.example', // guard-private: allow Synthetic fixture address
  });
  addApplication(s.db, 'acme', 'Acme');
  s.db
    .insert(applicationAddress)
    .values({ key: 'acme', address: 'jobs@acme.example', origin: 'manual', addedAt: new Date(now) }) // guard-private: allow Synthetic fixture address
    .run();
  await s.run();
  assert.equal(links(s.db)[0]?.key, 'acme');
  assert.equal(links(s.db)[0]?.linkReason, 'model');
});

void test('a known sender links even when its application is outside the model candidate limit', async () => {
  const s = setup({ config: { maxPerRun: 1 } });
  addApplication(s.db, 'old', 'Rossi ASD', { appliedAt: Date.UTC(2026, 0, 1) });
  for (let i = 0; i < 41; i++) addApplication(s.db, `new-${i}`, `Company ${i}`, { appliedAt: now });
  s.db
    .insert(applicationAddress)
    .values({ key: 'old', address: 'recruiter@example.org', origin: 'manual', addedAt: new Date(now) })
    .run();
  await s.run();
  assert.equal(links(s.db)[0]?.key, 'old');
});

void test('a sender shared by two applications does not link automatically', async () => {
  const s = setup({ config: { maxPerRun: 1 } });
  for (const key of ['one', 'two']) {
    addApplication(s.db, key, key);
    s.db
      .insert(applicationAddress)
      .values({ key, address: 'recruiter@example.org', origin: 'manual', addedAt: new Date(now) })
      .run();
  }
  await s.run();
  assert.equal(links(s.db).length, 0);
});
const proposals = (db: ReturnType<typeof setup>['db']) => db.select().from(mailProposals).all();
const statusOf = (db: ReturnType<typeof setup>['db'], key: string) =>
  db
    .select()
    .from(jobApplied)
    .all()
    .find((row) => row.key === key)?.status;

void test('a confident model match with matching corporate domain and company links it without saving thread addresses', async () => {
  const s = setup({
    bodies: { '310': 'Per la posizione presso Acme Corp vorremmo incontrarla.' },
    sender: 'hr@acme.example', // guard-private: allow Synthetic fixture address
    answers: {
      'Offerta di colloquio': {
        application: 'A1',
        confidence: 'alta',
        kind: 'invito',
        interviewDate: '2026-11-20',
        interviewTime: '15:30',
        interviewPlace: 'https://meet.example.org/abc',
      },
    },
  });
  addApplication(s.db, 'acme', 'Acme Corp');
  const result = await s.run();
  assert.equal(result.checked, 3);
  assert.deepEqual(
    links(s.db).map((l) => [l.key, l.account, l.messageId]),
    [['acme', 'work', 'offer@example.org']],
  );
  // Model-generated links never save application_address rows silently.
  assert.equal(s.db.select().from(applicationAddress).all().length, 0);
  const [proposal, ...rest] = proposals(s.db);
  assert.equal(rest.length, 0);
  assert.equal(proposal?.kind, 'interview');
  assert.equal(proposal?.scheduledAt?.getTime(), new Date(2026, 10, 20, 15, 30).getTime());
  assert.equal(proposal?.label, 'Colloquio, https://meet.example.org/abc');
  // Nothing changed on its own: no interview row, status untouched.
  assert.equal(s.db.select().from(jobInterview).all().length, 0);
  assert.equal(statusOf(s.db, 'acme'), 'pending');
});

void test('crafted alta mail from freemail or unknown domain naming company only creates a link proposal and stores no address', async () => {
  const senders = [
    'attacker@gmail.com', // guard-private: allow Synthetic fixture address
    'phish@unknown.example', // guard-private: allow Synthetic fixture address
    'phish@evil-acme.example', // guard-private: allow Synthetic fixture address
  ];
  for (const sender of senders) {
    const s = setup({
      bodies: { '310': 'Gentile candidato, Acme Corp chiede azione.' },
      sender,
      answers: {
        'Offerta di colloquio': {
          application: 'A1',
          confidence: 'alta',
          kind: 'invito',
          interviewDate: '2026-11-20',
          interviewTime: '15:30',
          interviewPlace: 'https://phish.example/meet',
          ask: 'Apri il link',
        },
      },
      config: { maxPerRun: 1 },
    });
    addApplication(s.db, 'acme', 'Acme Corp');
    const result = await s.run();
    assert.equal(result.linked, 0, sender);
    assert.equal(result.suggested, 1, sender);
    assert.equal(links(s.db).length, 0, sender);
    assert.equal(s.db.select().from(applicationAddress).all().length, 0, sender);
    const created = proposals(s.db);
    assert.equal(created.length, 1, sender);
    assert.equal(created[0]?.kind, 'link', sender);
  }
});

void test('an unsure match, and a confident one without the company in the mail, are suggestions and link nothing', async () => {
  const s = setup({
    bodies: { '310': 'Buongiorno, vorremmo proporle un colloquio.', '308': 'Grazie della risposta.' },
    answers: {
      'Offerta di colloquio': { application: 'A1', confidence: 'alta', kind: 'invito' },
      'Re: Domanda sul ruolo': { application: 'A1', confidence: 'media' },
    },
  });
  addApplication(s.db, 'acme', 'Acme Corp');
  const result = await s.run();
  assert.equal(result.linked, 0);
  assert.equal(result.suggested, 2);
  assert.equal(links(s.db).length, 0);
  assert.deepEqual(
    proposals(s.db)
      .map((p) => [p.kind, p.messageId])
      .toSorted((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1]))),
    [
      ['link', 'offer@example.org'],
      ['link', 'reply@example.org'],
    ],
  );
});

void test('a rejection proposes the status when sender domain is confirmed and the application keeps its status until confirmed', async () => {
  const s = setup({
    bodies: { '310': 'Gentile candidato, Acme Corp ha scelto un altro profilo.' },
    sender: 'hr@acme.example', // guard-private: allow Synthetic fixture address
    answers: {
      'Offerta di colloquio': { application: 'A1', confidence: 'alta', kind: 'rifiuto', why: 'Rifiuto esplicito' },
    },
  });
  addApplication(s.db, 'acme', 'Acme Corp');
  await s.run();
  assert.deepEqual(
    proposals(s.db).map((p) => [p.kind, p.status, p.why]),
    [['status', 'rejected', 'Rifiuto esplicito']],
  );
  assert.equal(statusOf(s.db, 'acme'), 'pending');
});

void test('a thread that already belongs to an application keeps it, whatever the model picks', async () => {
  const s = setup({ answers: { 'Offerta di colloquio': { application: 'nessuna', kind: 'rifiuto' } } });
  addApplication(s.db, 'acme', 'Acme Corp');
  // Our own reply (sent 43) is in the same thread as inbox 310.
  s.db
    .insert(jobMailLink)
    .values({ key: 'acme', account: 'work', messageId: 'followup@example.org', linkedAt: new Date(now) })
    .run();
  await s.run();
  assert.ok(s.requests.some((r) => r.prompt.includes('già collegata alla candidatura A1')));
  assert.equal(links(s.db).length, 1);
  assert.deepEqual(
    proposals(s.db).map((p) => [p.kind, p.status]),
    [['status', 'rejected']],
  );
});

void test('closed applications are never offered to the model', async () => {
  const s = setup();
  addApplication(s.db, 'old', 'Old Corp', { status: 'rejected', closedAt: now - 86_400_000 });
  addApplication(s.db, 'live', 'Live Corp');
  await s.run();
  const prompt = s.requests[0]?.prompt ?? '';
  assert.ok(prompt.includes('Live Corp'));
  assert.ok(!prompt.includes('Old Corp'));
});

void test('a mail is read once: ids already checked cost no model call on the next run, and a restart keeps them', async () => {
  const s = setup();
  addApplication(s.db, 'acme', 'Acme Corp');
  assert.equal((await s.run()).checked, 3);
  assert.equal(s.requests.length, 3);
  assert.equal((await s.run()).checked, 0);
  assert.equal(s.requests.length, 3);
  assert.equal(s.db.select().from(mailChecked).all().length, 3);
});

void test('newest first and bounded by maxPerRun: the rest waits for the next run', async () => {
  const s = setup({ config: { maxPerRun: 1 } });
  assert.equal((await s.run()).checked, 1);
  assert.deepEqual(
    s.db
      .select()
      .from(mailChecked)
      .all()
      .map((row) => row.messageId),
    ['offer@example.org'],
  );
  assert.equal((await s.run()).checked, 1);
  assert.equal(s.requests.length, 2);
});

void test('a provider failure stops the run and leaves the mail unread; an unusable answer is stored once', async () => {
  const down = setup({ answers: { 'Offerta di colloquio': 'down' } });
  const stopped = await down.run();
  assert.equal(stopped.checked, 0);
  assert.equal(stopped.reason, 'http 500');
  assert.equal(down.db.select().from(mailChecked).all().length, 0);
  assert.equal(down.requests.length, 1);

  const bad = setup({ answers: { 'Offerta di colloquio': 'invalid' } });
  await bad.run();
  const stored = bad.db.select().from(mailChecked).all();
  assert.equal(stored.find((row) => row.messageId === 'offer@example.org')?.outcome, 'invalid');
  const before = bad.requests.length;
  await bad.run();
  assert.equal(bad.requests.length, before);
});

void test('without accounts nothing is read and nothing is asked', async () => {
  const s = setup({ config: { accounts: [] } });
  assert.equal((await s.run()).checked, 0);
  assert.equal(s.requests.length, 0);
  assert.equal(s.mailCalls.length, 0);
});

void test('every call goes through the gate, uncounted, to the Ollama address, and the logs hold no mail text', async () => {
  const s = setup({
    bodies: { '310': 'Segreto del corpo della mail di Acme Corp' },
    answers: { 'Offerta di colloquio': 'down', 'Re: Domanda sul ruolo': 'invalid' },
  });
  addApplication(s.db, 'acme', 'Acme Corp');
  await s.run();
  await s.run();
  assert.ok(s.requests.length > 0);
  assert.ok(s.requests.every((request) => request.url === ollamaUrl));
  assert.equal(s.gateCalls.length, s.requests.length);
  assert.ok(s.gateCalls.every((options) => options?.counted === false));
  assert.equal(s.gate.used(), 0);
  assert.ok(s.records.length > 0);
  const logged = JSON.stringify(s.records);
  for (const secret of [
    'Segreto',
    'Offerta di colloquio',
    'Domanda sul ruolo',
    'recruiter@example.org',
    'carla@example.org',
  ])
    assert.ok(!logged.includes(secret), secret);
});

void test('a reply counts only when a sent message comes after the mail', () => {
  const sent = (date: string | null) => ({ mailbox: 'sent' as const, date });
  const inbox = (date: string) => ({ mailbox: 'inbox' as const, date });
  const mail = Date.parse('2026-11-07T09:00:00Z');
  assert.equal(repliedAt({ messages: [sent('2026-11-04T10:00:00Z'), inbox('2026-11-07T09:00:00Z')] }, mail), null);
  assert.equal(repliedAt({ messages: [inbox('2026-11-08T09:00:00Z'), sent(null)] }, mail), null);
  assert.equal(repliedAt(null, mail), null);
  assert.equal(
    repliedAt({ messages: [sent('2026-11-09T10:00:00Z'), sent('2026-11-07T14:00:00Z')] }, mail),
    Date.parse('2026-11-07T14:00:00Z'),
  );
});

const mailRows = (db: ReturnType<typeof setup>['db']) =>
  Object.fromEntries(
    db
      .select()
      .from(mailChecked)
      .all()
      .map((row) => [row.messageId, row.answeredAt?.getTime() ?? null]),
  );

void test('an item the owner replied to leaves Da fare, an earlier sent mail does not, and a run with no new mail still marks it', async () => {
  const s = setup({
    answers: {
      'Offerta di colloquio': { ask: 'Scegliere un orario' },
      'Re: Domanda sul ruolo': { ask: 'Rispondere con la disponibilità' },
    },
  });
  await s.run();
  // 310 is answered by sent 43 (later); 308 only follows our own earlier sent 42.
  assert.deepEqual(mailRows(s.db), {
    'offer@example.org': Date.parse('2026-11-07T14:00:00Z'),
    'reply@example.org': null,
    'news@example.org': null,
  });
  s.db.update(mailChecked).set({ answeredAt: null }).run();
  const again = await s.run();
  assert.equal(again.checked, 0);
  assert.equal(mailRows(s.db)['offer@example.org'], Date.parse('2026-11-07T14:00:00Z'));
});

void test('the queue orders by instant, not by string: mixed offsets, an unreadable date last', () => {
  const dates = [
    '2026-11-10T00:30:00+02:00',
    '2026-11-09T23:00:00+00:00',
    null,
    '2026-11-09T22:00:00-02:00',
    'garbage',
  ];
  // As instants: 22:30Z on the 9th, 23:00Z on the 9th, none, 00:00Z on the 10th, none.
  assert.deepEqual(dates.toSorted(newestFirst), [
    '2026-11-09T22:00:00-02:00',
    '2026-11-09T23:00:00+00:00',
    '2026-11-10T00:30:00+02:00',
    null,
    'garbage',
  ]);
});

void test('the application day the model sees is the local one: 00:30 local on the 1st is the 1st', () => {
  const zone = process.env.TZ;
  process.env.TZ = 'Europe/Rome';
  try {
    const s = setup();
    addApplication(s.db, 'acme', 'Acme Corp', { appliedAt: new Date(2026, 10, 1, 0, 30).getTime() });
    assert.equal(openCandidates(s.db)[0]?.appliedOn, '2026-11-01');
  } finally {
    if (zone === undefined) delete process.env.TZ;
    else process.env.TZ = zone;
  }
});
