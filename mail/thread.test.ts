import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeSubject, threadOf, type ThreadEntry } from './thread.ts';

const entry = (fields: Partial<ThreadEntry> & Pick<ThreadEntry, 'id' | 'mailbox'>): ThreadEntry => ({
  messageId: null,
  inReplyTo: [],
  subject: '',
  date: null,
  counterpart: null,
  ...fields,
});

const question = entry({
  id: '42',
  mailbox: 'sent',
  messageId: 'ask@example.org',
  subject: 'Domanda',
  date: '2026-11-04T10:00:00Z',
});
const reply = entry({
  id: '308',
  mailbox: 'inbox',
  messageId: 'reply@example.org',
  inReplyTo: ['ask@example.org'],
  date: '2026-11-05T15:00:00Z',
});

void test('a reply in the inbox joins the sent question into one thread, last message from the other side', () => {
  const thread = threadOf([question, reply], 'ask@example.org');
  assert.deepEqual(
    thread?.messages.map((message) => message.id),
    ['42', '308'],
  );
  assert.equal(thread?.waiting, false);
});

void test('the last message from the owner means the thread is waiting for a reply', () => {
  const followUp = entry({
    id: '43',
    mailbox: 'sent',
    messageId: 'followup@example.org',
    inReplyTo: ['reply@example.org'],
    date: '2026-11-07T14:00:00Z',
  });
  const thread = threadOf([question, reply, followUp], 'ask@example.org');
  assert.equal(thread?.waiting, true);
  assert.deepEqual(
    thread?.messages.map((message) => message.id),
    ['42', '308', '43'],
  );
});

void test('a message only in the sent mailbox is a thread of its own, waiting for a reply', () => {
  const alone = entry({ id: '7', mailbox: 'sent', messageId: 'alone@example.org', date: '2026-11-06T09:00:00Z' });
  const thread = threadOf([alone], 'alone@example.org');
  assert.deepEqual(
    thread?.messages.map((message) => message.id),
    ['7'],
  );
  assert.equal(thread?.waiting, true);
});

void test('an unrelated message is left out, and a Message-ID nobody lists has no thread', () => {
  const unrelated = entry({
    id: '309',
    mailbox: 'inbox',
    messageId: 'news@example.org',
    date: '2026-11-06T08:00:00Z',
  });
  const thread = threadOf([question, reply, unrelated], 'ask@example.org');
  assert.equal(
    thread?.messages.some((message) => message.id === '309'),
    false,
  );
  assert.equal(threadOf([question, reply], 'missing@example.org'), null);
});

void test('a message without a Message-ID cannot be linked and is left out', () => {
  const headless = entry({ id: '5', mailbox: 'inbox', inReplyTo: ['ask@example.org'], date: '2026-11-05T00:00:00Z' });
  const thread = threadOf([question, headless], 'ask@example.org');
  assert.deepEqual(
    thread?.messages.map((message) => message.id),
    ['42'],
  );
});

void test('normalizes reply and calendar prefixes and the calendar date tail', () => {
  for (const prefix of [
    'R: Re: I: Fwd:',
    'Re[2]:',
    'Ri:',
    'Fw:',
    'Inoltro:',
    'Accettato:',
    'Accepted:',
    'Rifiutato:',
    'Declined:',
    'Provvisorio:',
    'Tentative:',
    'Invito:',
    'Invitation:',
    'Invito aggiornato:',
    'Updated invitation:',
  ]) {
    assert.equal(normalizeSubject(`${prefix}  Project   meeting @ 12 Nov 2026 10:00`), 'project meeting');
  }
});

void test('joins the recruiter conversation by subject and exact address, preserving dates and stable key', () => {
  const make = (
    id: string,
    subject: string,
    date: string | null,
    mailbox: 'inbox' | 'sent' = 'inbox',
    counterpart = 'Recruiter@example.com',
    inReplyTo: string[] = [],
  ) => entry({ id, messageId: `${id}@example.com`, subject, date, mailbox, counterpart, inReplyTo });
  const entries = [
    make('a', 'Project meeting', '2026-11-01'),
    make('b', 'Invito: Project meeting @ 12 Nov 2026 10:00', '2026-11-02'),
    make('c', 'Accettato: Project meeting @ 12 Nov 2026 10:00', '2026-11-03', 'sent'),
    make('d', 'R: R: Project meeting', '2026-11-04', 'sent', 'recruiter@example.com', ['b@example.com']),
    make('e', 'Invitation: Project meeting @ 14 Nov 2026 10:00', '2026-11-05'),
    make('f', 'Project meeting', '2026-11-06', 'inbox', 'other@example.com'),
    make('g', 'Different topic', '2026-11-07'),
    make('h', 'Project meeting', null, 'sent'),
  ];
  const thread = threadOf(entries, 'b@example.com');
  assert.deepEqual(
    thread?.messages.map((message) => message.id),
    ['a', 'b', 'c', 'd', 'e', 'h'],
  );
  assert.equal(thread?.waiting, false);
  assert.equal(thread?.key, 'a@example.com');
  assert.equal(threadOf(entries, 'e@example.com')?.key, thread?.key);
  assert.notEqual(threadOf(entries, 'f@example.com')?.key, thread?.key);
  assert.notEqual(threadOf(entries, 'g@example.com')?.key, thread?.key);
  assert.equal(threadOf(entries.slice(0, 4), 'a@example.com')?.waiting, true);
  assert.equal(threadOf(entries.slice(0, 3), 'a@example.com')?.waiting, false);
});

void test('automated senders, missing addresses and short subjects do not join by subject', () => {
  for (const counterpart of [
    'noreply@example.com',
    'no-reply@example.com',
    'donotreply@example.com',
    'do-not-reply@example.com',
    'notification@example.com',
    'notifications@example.com',
    'mailer-daemon@example.com',
    null,
  ]) {
    const entries = ['a', 'b', 'c'].map((id) =>
      entry({
        id,
        mailbox: 'inbox',
        messageId: `${id}@example.com`,
        counterpart,
        subject: 'Application',
        inReplyTo: id === 'b' ? ['a@example.com'] : [],
      }),
    );
    assert.equal(threadOf(entries, 'a@example.com')?.messages.length, 2);
    assert.notEqual(threadOf(entries, 'a@example.com')?.key, threadOf(entries, 'c@example.com')?.key);
  }
  const short = ['a', 'b'].map((id) =>
    entry({
      id,
      mailbox: 'inbox',
      messageId: `${id}@example.com`,
      counterpart: 'person@example.com',
      subject: 'Re: abc',
    }),
  );
  assert.equal(threadOf(short, 'a@example.com')?.messages.length, 1);
});
