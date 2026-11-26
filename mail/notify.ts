import type { Run } from '../../apps/server/src/core/exec.ts';
import type { MailLive, MailSnapshot } from './live.ts';
import type { MailMessage } from './himalaya.ts';

// More than this many in one read is one line instead of a burst of notifications.
export const NOTIFY_EACH_MAX = 3;
const SUBJECT_CHARS = 80;

const cut = (text: string) => (text.length > SUBJECT_CHARS ? `${text.slice(0, SUBJECT_CHARS - 3)}...` : text);
const sender = (message: MailMessage) => message.from?.name || message.from?.email || 'Mittente sconosciuto';
const escapeMarkup = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/**
 * Turns each state of the inboxes into desktop notifications for the unread messages not seen before. The first good
 * read of an account only records what is there; ids are kept per account, bounded by the rows the state carries.
 */
export function createNewMailNotifier(run: Run) {
  const known = new Map<string, Set<string>>();
  return function observe(state: MailSnapshot) {
    const fresh: MailMessage[] = [];
    for (const account of state.accounts) {
      // A failed read says nothing about what is there: keep what was known.
      if (account.failure) continue;
      const before = known.get(account.account);
      known.set(account.account, new Set(account.window.map((message) => message.id)));
      if (before) fresh.push(...account.window.filter((message) => !message.seen && !before.has(message.id)));
    }
    if (fresh.length > NOTIFY_EACH_MAX) {
      void run('notify-send', ['--app-name', 'Hub', '--', 'Nuova mail', `${fresh.length} nuove mail`]);
      return;
    }
    for (const message of fresh) {
      void run('notify-send', [
        '--app-name',
        'Hub',
        '--',
        'Nuova mail',
        escapeMarkup(`${sender(message)}: ${cut(message.subject)}`),
      ]);
    }
  };
}

/** One internal subscriber, from module start to close, so the inboxes are polled with no page open. */
export function watchNewMail(live: MailLive, run: Run) {
  const observe = createNewMailNotifier(run);
  const stop = new AbortController();
  async function consume() {
    try {
      for await (const state of live.subscribe(stop.signal)) observe(state);
    } catch {
      // The abort at close ends the iterator by throwing; so does a failed read, and there is nothing to report.
    }
  }
  const done = consume();
  return async () => {
    stop.abort();
    await done;
  };
}
