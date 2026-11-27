import type { NewMailEvent } from '../../apps/server/src/core/module.ts';
import type { Run } from '../../apps/server/src/core/exec.ts';
import type { MailLive, MailSnapshot } from './live.ts';
import type { MailMessage } from './himalaya.ts';

// More than this many in one read is one line instead of a burst of notifications.
export const NOTIFY_EACH_MAX = 3;
const SUBJECT_CHARS = 80;

const cut = (text: string) => (text.length > SUBJECT_CHARS ? `${text.slice(0, SUBJECT_CHARS - 3)}...` : text);
const sender = (message: MailMessage) => message.from?.name || message.from?.email || 'Mittente sconosciuto';
const escapeMarkup = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

type MailObserverOptions = { notify?: boolean; onNewMail?: (event: NewMailEvent) => void };

/** The first good read records a baseline; subsequent snapshots emit fresh unread IDs and optional notifications. */
export function createNewMailNotifier(run: Run, { notify = true, onNewMail }: MailObserverOptions = {}) {
  const known = new Map<string, Set<string>>();
  return function observe(state: MailSnapshot) {
    const fresh: MailMessage[] = [];
    for (const account of state.accounts) {
      // A failed read says nothing about what is there: keep what was known.
      if (account.failure) continue;
      const before = known.get(account.account);
      known.set(account.account, new Set(account.window.map((message) => message.id)));
      if (!before) continue;
      const messages = account.window.filter((message) => !message.seen && !before.has(message.id));
      if (messages.length > 0)
        onNewMail?.({ account: account.account, messageIds: messages.map((message) => message.id) });
      fresh.push(...messages);
    }
    if (!notify) return;
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

/** One internal subscriber keeps inboxes polling without an open page until stopped. */
export function watchNewMail(live: MailLive, run: Run, options?: MailObserverOptions) {
  const observe = createNewMailNotifier(run, options);
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
