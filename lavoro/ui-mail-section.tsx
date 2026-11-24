import { LoadingSkeleton } from '../../apps/web/src/components/ui/loading-skeleton.tsx';
import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import { PlusIcon, XIcon } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MailThreadAnswer } from '../../apps/server/src/core/capabilities.ts';
import { useIsOn } from '../../apps/web/src/lib/module-enabled.ts';
import { copy } from './copy.ts';
import { ConnectMail } from './ui-mail-connect.tsx';
import { linksKey, lavoroMailClient, useApplicationLinks, useLinkedThreads, useMailAccounts } from './ui-mail-data.ts';
import { MailThread } from './ui-mail-thread.tsx';
import type { JobRow } from './server.ts';

export function MailSection({ job }: { job: JobRow }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const [address, setAddress] = useState('');
  const mailOn = useIsOn()('mail');
  const accounts = useMailAccounts();
  const links = useApplicationLinks(job.key);
  const cache = useQueryClient();
  const addressKey = ['lavoro', 'addresses', job.key];
  const addresses = useQuery({
    queryKey: addressKey,
    queryFn: () => lavoroMailClient.addresses.list.query({ key: job.key }),
  });
  const suggestions = useQuery({
    queryKey: [...addressKey, 'suggestions'],
    queryFn: () => lavoroMailClient.addresses.suggestions.query({ key: job.key }),
    retry: false,
  });
  async function updateAddress(value: string, remove = false, suggested = false) {
    try {
      if (remove) await lavoroMailClient.addresses.remove.mutate({ key: job.key, address: value });
      else
        await lavoroMailClient.addresses.add.mutate({
          key: job.key,
          address: value,
          origin: suggested ? 'sent' : 'manual',
        });
      setAddress('');
      await cache.invalidateQueries({ queryKey: addressKey });
    } catch {
      setError(true);
    }
  }
  const enabled = mailOn && accounts.isSuccess && accounts.data.length > 0;
  const threads = useLinkedThreads(links.data ?? [], enabled && links.isSuccess);
  useEffect(() => {
    const resolved = (threads.data ?? []).filter((answer) => answer.resolvedMessageId);
    if (!resolved.length) return;
    void Promise.all(
      resolved.map((answer) =>
        lavoroMailClient.links.resolve.mutate({
          key: job.key,
          account: answer.account,
          messageId: answer.messageId,
          resolvedMessageId: answer.resolvedMessageId ?? '',
        }),
      ),
    )
      .then(() => cache.invalidateQueries({ queryKey: linksKey }))
      .catch(() => setError(true));
  }, [threads.data, job.key, cache]);
  const grouped = new Map<string, MailThreadAnswer[]>();
  for (const answer of threads.data ?? []) {
    const key = JSON.stringify([answer.account, answer.thread?.key ?? answer.messageId]);
    const group = grouped.get(key) ?? [];
    group.push(answer);
    grouped.set(key, group);
  }
  async function remove(account: string, messageId: string) {
    try {
      await lavoroMailClient.links.remove.mutate({ key: job.key, account, messageId, confirmed: true });
      await cache.invalidateQueries({ queryKey: linksKey });
    } catch {
      setError(true);
    }
  }
  return (
    <section className="flex flex-col gap-sm border-t border-border pt-sm" aria-label={copy.candidature.mail.title}>
      <div className="flex items-center justify-between gap-sm">
        <h4 className="text-label font-semibold">{copy.candidature.mail.title}</h4>
        {enabled && (
          <button type="button" className="min-h-touch underline" onClick={() => setOpen(true)}>
            {copy.candidature.mail.connect}
          </button>
        )}
      </div>
      <div className="flex flex-col gap-xs">
        <h5 className="text-label font-semibold">{copy.candidature.mail.addresses}</h5>
        <ul>
          {addresses.data?.map((row) => (
            <li key={row.address} className="flex items-center justify-between gap-sm">
              <span>{row.address}</span>
              <button
                type="button"
                className="flex size-touch shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                aria-label={copy.candidature.mail.removeAddress(row.address)}
                onClick={() => void updateAddress(row.address, true)}
              >
                <XIcon aria-hidden className="size-icon-sm" />
              </button>
            </li>
          ))}
        </ul>
        <form
          className="flex items-center gap-sm"
          onSubmit={(event) => {
            event.preventDefault();
            void updateAddress(address.trim());
          }}
        >
          <input
            type="email"
            required
            aria-label={copy.candidature.mail.addAddress}
            placeholder={copy.candidature.mail.addressExample}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            className="h-touch min-w-0 rounded-lg border border-border/40 bg-surface/70 px-sm text-label text-foreground focus:border-primary/50 focus:outline-none"
          />
          <button type="submit" className="min-h-touch underline">
            {copy.candidature.mail.addAddress}
          </button>
        </form>
        {!!suggestions.data?.length && (
          <>
            <h5 className="text-label font-semibold">{copy.candidature.mail.suggestedAddress}</h5>
            <ul>
              {suggestions.data.map((value) => (
                <li key={value} className="flex items-center justify-between gap-sm">
                  <span>{value}</span>
                  <button
                    type="button"
                    className="flex size-touch shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    aria-label={copy.candidature.mail.acceptAddress(value)}
                    onClick={() => void updateAddress(value, false, true)}
                  >
                    <PlusIcon aria-hidden className="size-icon-sm" />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      {!mailOn || accounts.isError || (accounts.isSuccess && !enabled) ? (
        <p>{copy.candidature.mail.unavailable}</p>
      ) : null}
      {enabled && links.isError && <p>{copy.candidature.mail.unknown}</p>}
      {enabled && links.isSuccess && links.data.length === 0 && <EmptyState title={copy.candidature.mail.empty} />}
      {enabled &&
        links.data &&
        links.data.length > 0 &&
        (threads.isError ? (
          <ul aria-label={copy.candidature.mail.conversations}>
            {links.data.map((link: { account: string; messageId: string }) => (
              <MailThread
                key={`${link.account}:${link.messageId}`}
                answer={{ account: link.account, messageId: link.messageId, thread: null, status: 'account' }}
                onRemove={remove}
              />
            ))}
          </ul>
        ) : !threads.data ? (
          <LoadingSkeleton label={copy.candidature.mail.loading} rows={3} />
        ) : (
          <ul aria-label={copy.candidature.mail.conversations}>
            {[...grouped.values()].map((group) => (
              <MailThread
                key={`${group[0].account}:${group[0].messageId}`}
                answer={group[0]}
                links={group}
                onRemove={remove}
              />
            ))}
          </ul>
        ))}
      {error && <p>{copy.candidature.mail.error}</p>}
      {enabled && accounts.data && job.application && (
        <ConnectMail
          open={open}
          setOpen={setOpen}
          jobKey={job.key}
          company={job.company}
          appliedAt={job.application.appliedAt}
          accounts={accounts.data}
        />
      )}
    </section>
  );
}
