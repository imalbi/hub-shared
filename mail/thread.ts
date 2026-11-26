import type { MailThreadEntry, MailThreadView } from '../../apps/server/src/core/module.ts';

export type ThreadEntry = MailThreadEntry;
export type ThreadView = MailThreadView;

/** Union-find over Message-IDs: a reply joins its parent, so one connected set is one thread. */
function createGroups() {
  const parent = new Map<string, string>();
  const add = (id: string) => {
    if (!parent.has(id)) parent.set(id, id);
  };
  const find = (id: string): string => {
    const up = parent.get(id);
    if (up === undefined || up === id) return id;
    const root = find(up);
    parent.set(id, root);
    return root;
  };
  const join = (a: string, b: string) => {
    add(a);
    add(b);
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };
  return { find, join };
}

const PREFIXES =
  'updated invitation|invito aggiornato|accettato|accepted|rifiutato|declined|provvisorio|tentative|invitation|invito|inoltro|fwd|re|ri|fw|r|i';
const prefix = new RegExp(`^(?:${PREFIXES})(?:\\[\\d+\\])?\\s*:\\s*`, 'i');
const calendarReply = /^(?:accettato|accepted|rifiutato|declined|provvisorio|tentative)(?:\[\d+\])?\s*:/i;
const automated = /^(?:noreply|no-reply|donotreply|do-not-reply|notifications?|mailer-daemon)$/;

export function normalizeSubject(subject: string): string {
  let normalized = subject.toLowerCase().trim().replace(/\s+/g, ' ');
  while (prefix.test(normalized)) normalized = normalized.replace(prefix, '').trim();
  return normalized.replace(/\s+@\s+.+$/, '').trim();
}

const timestamp = (entry: ThreadEntry) => {
  const time = entry.date === null ? Number.NaN : Date.parse(entry.date);
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
};
const byDate = (a: ThreadEntry, b: ThreadEntry) => timestamp(a) - timestamp(b);

/**
 * The thread that holds `messageId`, from the inbox and sent listings of one account. Messages without a Message-ID
 * cannot be linked and are left out. Returns null when no listed message carries that id.
 */
export function threadOf(entries: readonly ThreadEntry[], messageId: string): ThreadView | null {
  if (!entries.some((entry) => entry.messageId === messageId)) return null;
  const groups = createGroups();
  const subjects = new Map<string, string>();
  for (const entry of entries) {
    if (entry.messageId === null) continue;
    for (const parentId of entry.inReplyTo) groups.join(entry.messageId, parentId);
    const subject = normalizeSubject(entry.subject);
    const counterpart = entry.counterpart?.toLowerCase();
    if (!counterpart || automated.test(counterpart.split('@')[0] ?? '') || subject.length < 4) continue;
    const key = JSON.stringify([counterpart, subject]);
    const previous = subjects.get(key);
    if (previous) groups.join(entry.messageId, previous);
    else subjects.set(key, entry.messageId);
  }

  const root = groups.find(messageId);
  const messages = entries
    .filter((entry) => entry.messageId !== null && groups.find(entry.messageId) === root)
    .toSorted(byDate);
  const last = messages.findLast(
    (entry) =>
      Number.isFinite(timestamp(entry)) && !(entry.mailbox === 'sent' && calendarReply.test(entry.subject.trim())),
  );
  const key =
    messages.flatMap((entry) => (entry.messageId === null ? [] : [entry.messageId])).toSorted()[0] ?? messageId;
  return { messageId, key, waiting: last?.mailbox === 'sent', messages };
}
