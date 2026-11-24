import { useState } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Dialog } from '../../apps/web/src/components/ui/dialog.tsx';
import { SearchInput } from '../../apps/web/src/components/ui/search-input.tsx';
import { useMailTRPC } from '../../apps/web/src/modules/mail/use-mail.ts';
import { copy } from './copy.ts';
import { linksKey, lavoroMailClient } from './ui-mail-data.ts';
import type { MailMessage } from '../../apps/server/src/modules/mail/himalaya.ts';

export function ConnectMail({
  open,
  setOpen,
  jobKey,
  company,
  appliedAt,
  accounts,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  jobKey: string;
  company: string;
  appliedAt: number;
  accounts: { account: string; label: string }[];
}) {
  const [search, setSearch] = useState('');
  const [error, setError] = useState(false);
  const trpc = useMailTRPC();
  const cache = useQueryClient();
  const term = search.trim() || company;
  const after = new Date(appliedAt - 3 * 86_400_000).toISOString().slice(0, 10);
  const dateFilter = search.trim() ? {} : { after };
  const queries = useQueries({
    queries: accounts.flatMap(({ account }) =>
      ['INBOX', 'sent'].flatMap((mailbox) => [
        trpc.search.queryOptions(
          { account, mailbox, filter: { from: term, ...dateFilter } },
          { enabled: open && !!term, retry: false },
        ),
        trpc.search.queryOptions(
          { account, mailbox, filter: { subject: term, ...dateFilter } },
          { enabled: open && !!term, retry: false },
        ),
      ]),
    ),
  });
  const found = new Map<
    string,
    { account: string; subject: string; from: string; date: string | null; messageId: string }
  >();
  queries.forEach((query: { data?: MailMessage[] }, index: number) => {
    const account = accounts[Math.floor(index / 4)]?.account;
    if (!account) return;
    for (const row of query.data ?? [])
      if (row.messageId && !found.has(row.messageId))
        found.set(row.messageId, {
          account,
          subject: row.subject,
          from: row.from?.name || row.from?.email || copy.candidature.mail.unknownSender,
          date: row.date,
          messageId: row.messageId,
        });
  });
  async function connect(account: string, messageId: string) {
    try {
      await lavoroMailClient.links.add.mutate({ key: jobKey, account, messageId });
      await cache.invalidateQueries({ queryKey: linksKey });
      setOpen(false);
    } catch {
      setError(true);
    }
  }
  return (
    <Dialog open={open} onOpenChange={setOpen} title={copy.candidature.mail.connect} closeLabel={copy.actions.cancel}>
      <div className="flex flex-col gap-md">
        <SearchInput
          aria-label={copy.candidature.mail.search}
          placeholder={copy.candidature.mail.search}
          shortcut={null}
          onSearch={setSearch}
        />
        <p className="text-caption text-muted-foreground">{copy.candidature.mail.suggestions}</p>
        {queries.some((query: { isError: boolean }) => query.isError) && <p>{copy.candidature.mail.unknown}</p>}
        {queries.some((query: { isFetching: boolean }) => query.isFetching) && <p>{copy.candidature.mail.loading}</p>}
        {!queries.some((query: { isFetching: boolean; isError: boolean }) => query.isFetching || query.isError) &&
          found.size === 0 && <p>{copy.candidature.mail.noResults}</p>}
        {error && <p>{copy.candidature.mail.error}</p>}
        <ul>
          {[...found.values()].map((message) => (
            <li key={message.messageId} className="border-b border-border py-xs">
              <button
                type="button"
                className="w-full text-left"
                onClick={() => void connect(message.account, message.messageId)}
              >
                <span className="block text-label">{message.subject}</span>
                <span className="text-caption text-muted-foreground">
                  {message.from} · {message.date?.slice(0, 10)} · {message.account}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}
