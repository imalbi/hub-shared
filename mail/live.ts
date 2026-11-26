import type { Run } from '../../apps/server/src/core/exec.ts';
import { createLiveHub } from '../../apps/server/src/core/live.ts';
import type { MailAccount } from './config.ts';
import {
  envelopesSchema,
  himalaya,
  listArgs,
  toMessage,
  UNREAD_WINDOW,
  type MailFailure,
  type MailMessage,
} from './himalaya.ts';

// Mail is checked once a minute, and only while a client is watching: the poll is the only load it puts on the server.
export const MAIL_POLL_MS = 60_000;
const LATEST_ROWS = 10;

export type MailAccountState = {
  account: string;
  label: string;
  /** Unread rows among the newest `UNREAD_WINDOW`; null when the account could not be read. */
  unread: number | null;
  /** The window was full, so there may be more unread rows than `unread` says. */
  capped: boolean;
  failure: MailFailure | null;
  latest: MailMessage[];
};
export type MailState = { accounts: MailAccountState[] };
export type MailSnapshot = { accounts: (MailAccountState & { window: MailMessage[] })[] };

async function readAccount({ account, label }: MailAccount, run: Run): Promise<MailSnapshot['accounts'][number]> {
  const result = await himalaya(run, listArgs(account, 'INBOX', 1, UNREAD_WINDOW), envelopesSchema);
  if (!result.ok)
    return { account, label, unread: null, capped: false, failure: result.failure, latest: [], window: [] };
  const messages = result.value.envelopes.map(toMessage);
  return {
    account,
    label,
    unread: messages.filter((message) => !message.seen).length,
    capped: messages.length >= UNREAD_WINDOW,
    failure: null,
    latest: messages.slice(0, LATEST_ROWS),
    window: messages,
  };
}

export function readMailState(run: Run, accounts: readonly MailAccount[]): Promise<MailSnapshot> {
  return Promise.all(accounts.map((item) => readAccount(item, run))).then((states) => ({ accounts: states }));
}

export function createMailLive(run: Run, accounts: readonly MailAccount[]) {
  return createLiveHub(() => readMailState(run, accounts), MAIL_POLL_MS);
}

export type MailLive = ReturnType<typeof createMailLive>;
