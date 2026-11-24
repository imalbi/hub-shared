import { EnvelopeIcon } from '@phosphor-icons/react';
import { Tile } from '../../apps/web/src/components/tile.tsx';
import { copy } from './copy.ts';
import { summarizeMail } from './summary.ts';
import { useMail } from './use-mail.ts';

export function MailTile() {
  const mail = useMail();
  const accounts = mail.data?.accounts;
  const summary = accounts && summarizeMail(accounts);
  const state = !summary
    ? copy.tileLoading
    : summary.count === null
      ? copy.error
      : summary.capped
        ? copy.countCapped(summary.count)
        : copy.count(summary.count);
  return <Tile icon={EnvelopeIcon} label={copy.title} state={state} badge={summary?.count || undefined} />;
}
