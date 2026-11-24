import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ActionButton } from '../../apps/web/src/components/ui/action-button.tsx';
import { Badge } from '../../apps/web/src/components/ui/badge.tsx';
import { Panel } from '../../apps/web/src/components/panel.tsx';
import { AnimatedRow, AnimatedRows } from '../../apps/web/src/components/animated-list.tsx';
import { createModuleClient } from '../../apps/web/src/lib/module-client.ts';
import { copy } from './copy.ts';
import type { MailCheckState } from './mail-check.ts';
import type definition from './server.ts';
import { linksKey } from './ui-mail-data.ts';

const client = createModuleClient<typeof definition>('lavoro');
const proposalsKey = ['lavoro', 'mail-proposals'];
const when = new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * What the local model proposes from the mail: a link, a status or an interview. Each is one tap to confirm and nothing
 * changes before it. Renders nothing while the check is off (no account configured for it).
 */
export function MailProposals({ check, onChanged }: { check: MailCheckState | null; onChanged: () => void }) {
  const cache = useQueryClient();
  const [keepPanel, setKeepPanel] = React.useState(false);
  const info = useQuery({ queryKey: [...proposalsKey, 'info'], queryFn: () => client.mailCheck.info.query() });
  // shortcut: the list is polled; a push channel is not worth it for a few rows a day.
  const list = useQuery({
    queryKey: proposalsKey,
    queryFn: () => client.mailCheck.proposals.query(),
    enabled: info.data?.enabled === true,
    refetchInterval: 15_000,
  });
  // Any push of the check's state may mean a new proposal. A run can start and end between two renders, so waiting for
  // `running` to flip would miss it: read the list again whenever the state changes.
  const { running = false, done, remaining, reason, date } = check ?? {};
  React.useEffect(() => {
    void cache.invalidateQueries({ queryKey: proposalsKey });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- check state push triggers proposal list invalidation.
  }, [running, done, remaining, reason, date, cache]);

  const proposals = list.data ?? [];
  if (!info.data?.enabled) return null;

  async function settle(action: 'accept' | 'dismiss', id: number) {
    if (proposals.length === 1) setKeepPanel(true);
    await client.mailCheck[action].mutate({ id });
    await cache.invalidateQueries({ queryKey: proposalsKey });
    if (action === 'accept') {
      await cache.invalidateQueries({ queryKey: linksKey });
      onChanged();
    }
  }

  const status = running
    ? copy.mailCheck.running(check?.done ?? 0, check?.remaining ?? 0)
    : check?.reason
      ? copy.mailCheck.stopped(check.reason)
      : null;
  const runButton = (
    <ActionButton
      size="sm"
      variant="outline"
      label={copy.mailCheck.run}
      disabled={running}
      action={async () => {
        await client.mailCheck.run.mutate();
        onChanged();
      }}
    />
  );

  if (proposals.length === 0 && !keepPanel)
    return (
      <div className="flex items-center justify-between gap-md py-xs text-label text-muted-foreground">
        <p>{status}</p>
        {runButton}
      </div>
    );

  return (
    <Panel title={copy.mailCheck.title} action={runButton} className="mb-md">
      {status && <p className="text-label text-muted-foreground">{status}</p>}
      <ul className="flex flex-col">
        <AnimatedRows
          onExitComplete={() => {
            if (proposals.length === 0) setKeepPanel(false);
          }}
        >
          {proposals.map((proposal) => (
            <AnimatedRow
              key={proposal.id}
              className="flex flex-wrap items-center justify-between gap-md border-t border-dashed border-border py-sm first:border-t-0 first:pt-0"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2xs">
                <div className="flex items-center gap-xs">
                  <Badge size="sm" tone="primary" outline>
                    {copy.mailCheck.kind[proposal.kind]}
                  </Badge>
                  <p className="min-w-0 text-body">
                    {proposal.kind === 'link' && (
                      <span>{copy.mailCheck.link(proposal.subject, proposal.company, proposal.title)}</span>
                    )}
                    {proposal.kind === 'status' && proposal.status && (
                      <span>
                        {copy.mailCheck.status(
                          proposal.company,
                          proposal.title,
                          copy.candidature.status[proposal.status],
                        )}
                      </span>
                    )}
                    {proposal.kind === 'interview' && proposal.scheduledAt !== null && (
                      <span>
                        {copy.mailCheck.interview(
                          proposal.company,
                          when.format(proposal.scheduledAt),
                          proposal.label ?? '',
                        )}
                      </span>
                    )}
                  </p>
                </div>
                <p className="truncate text-label text-muted-foreground">
                  {proposal.why ? `${proposal.why}. ` : ''}
                  {proposal.sender ? `${copy.today.todo.from(proposal.sender)}. ` : ''}
                  {proposal.kind === 'link' ? '' : copy.mailCheck.fromMail(proposal.subject)}
                </p>
              </div>
              <div className="flex items-center gap-xs">
                <ActionButton
                  size="sm"
                  variant="ghost"
                  label={copy.mailCheck.dismiss}
                  aria-label={`${copy.mailCheck.dismiss}: ${proposal.subject}`}
                  action={() => settle('dismiss', proposal.id)}
                />
                <ActionButton
                  size="sm"
                  label={copy.mailCheck.confirm}
                  aria-label={`${copy.mailCheck.confirm}: ${proposal.subject}`}
                  action={() => settle('accept', proposal.id)}
                />
              </div>
            </AnimatedRow>
          ))}
        </AnimatedRows>
      </ul>
    </Panel>
  );
}
