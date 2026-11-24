import { Link, useRouter } from '@tanstack/react-router';
import { Panel } from '../../apps/web/src/components/panel.tsx';
import { Readout } from '../../apps/web/src/components/readout.tsx';
import { LoadingSkeleton } from '../../apps/web/src/components/ui/loading-skeleton.tsx';
import { NumberRoll } from '../../apps/web/src/components/ui/number-roll.tsx';
import type { WidgetSize } from '../../apps/web/src/lib/widget-size.ts';
import { copy } from './copy.ts';
import { postaHref } from './search.ts';
import { mailSender, mailTime, recentMail, summarizeMail } from './summary.ts';
import { useMail } from './use-mail.ts';

/** Panoramica widget: Piccolo shows unread figure + latest sender/time; Medio adds the 3 newest messages. */
export function MailWidget({ size }: { size: WidgetSize }) {
  const router = useRouter();
  const mail = useMail();
  const accounts = mail.data?.accounts;
  const summary = accounts && summarizeMail(accounts);
  const newest = accounts ? recentMail(accounts, 3) : [];
  const latest = newest[0];
  const accountNames = accounts?.map((entry) => entry.label).join(', ');
  const headerState = accountNames ? <span className="text-muted-foreground">{accountNames}</span> : undefined;

  if (!summary) {
    return (
      <Panel title={copy.title} className="h-full" action={headerState}>
        <LoadingSkeleton label={copy.tileLoading} rows={2} />
      </Panel>
    );
  }

  if (summary.count === null) {
    return (
      <Panel title={copy.title} className="h-full" action={headerState}>
        <p className="mt-auto text-body text-muted-foreground">{copy.error}</p>
      </Panel>
    );
  }

  const unreadBlock = (
    <p className="shrink-0">
      {summary.capped && copy.atLeast}
      <Readout>
        <NumberRoll value={summary.count} />
      </Readout>{' '}
      <span className="block text-caption text-muted-foreground">{copy.widgetUnread}</span>
    </p>
  );

  if (size === 'small') {
    const sender = latest ? mailSender(latest.from) : '';
    const time = latest ? mailTime(latest.date) : '';
    return (
      <Panel title={copy.title} className="relative h-full" action={headerState}>
        <Link
          to="/desk/messaggi"
          aria-label={copy.zoneOpen}
          className="absolute inset-0 rounded-lg focus-visible:outline focus-visible:outline-accent"
        />
        <div className="mt-auto flex min-w-0 items-end justify-between gap-sm">
          {unreadBlock}
          {sender && (
            <p className="min-w-0 truncate text-label text-muted-foreground tabular-nums">
              {time ? copy.widgetLatest(sender, time) : copy.widgetLatestNoTime(sender)}
            </p>
          )}
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={copy.title} className="h-full" action={headerState}>
      <div className="flex min-h-0 flex-1 items-stretch gap-lg">
        <div className="relative flex shrink-0 flex-col justify-end border-r border-border pr-lg">
          <Link
            to="/desk/messaggi"
            aria-label={copy.zoneOpen}
            className="absolute inset-0 rounded-sm focus-visible:outline focus-visible:outline-accent"
          />
          {unreadBlock}
        </div>
        <ul className="flex min-w-0 flex-1 flex-col justify-center">
          {newest.map((message) => {
            const href = postaHref(message.subject, `${message.account}:${message.id}`);
            const sender = mailSender(message.from);
            const time = mailTime(message.date);
            return (
              <li
                key={`${message.account}:${message.id}`}
                className="min-w-0 border-b border-dashed border-border last:border-b-0"
              >
                <a
                  href={href}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                    event.preventDefault();
                    router.history.push(href);
                  }}
                  className="flex min-w-0 items-center justify-between gap-sm py-2xs hover:text-foreground focus-visible:outline focus-visible:outline-accent"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-xs">
                    <span
                      aria-hidden
                      className={`size-2xs shrink-0 rounded-full ${message.seen ? 'opacity-0' : 'bg-foreground'}`}
                    />
                    <span className="min-w-0 flex-1 truncate text-body">
                      {sender ? `${sender} · ${message.subject}` : message.subject}
                    </span>
                  </span>
                  {time && <span className="shrink-0 text-figure text-muted-foreground">{time}</span>}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}
