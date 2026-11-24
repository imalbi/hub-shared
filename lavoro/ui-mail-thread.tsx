import { LoadingSkeleton } from '../../apps/web/src/components/ui/loading-skeleton.tsx';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MailMessage, MailThreadEntry, MailThreadView } from '../../apps/server/src/core/capabilities.ts';
import { HoldButton } from '../../apps/web/src/components/hold-button.tsx';
import { copy } from './copy.ts';
import { useMailTRPC } from './ui-mail-data.ts';

type Answer = {
  account: string;
  messageId: string;
  thread: MailThreadView | null;
  status?: 'ok' | 'account' | 'missing' | 'timeout';
};

function ThreadMessage({ account, message }: { account: string; message: MailThreadEntry }) {
  const [reading, setReading] = useState(false);
  const mail = useMailTRPC();
  const cache = useQueryClient();
  const mailbox = message.folder ?? (message.mailbox === 'sent' ? 'sent' : 'INBOX');
  const sender = useQuery({
    queryKey: ['lavoro', 'mail-sender', account, mailbox, message.id, message.date],
    enabled: !!message.date,
    retry: false,
    queryFn: async () => {
      if (!message.date) return null;
      const after = new Date(new Date(message.date).getTime() - 86_400_000).toISOString().slice(0, 10);
      for (let page = 1; page <= 8; page++) {
        const rows: MailMessage[] = await cache.fetchQuery(
          mail.search.queryOptions({ account, mailbox, filter: { after }, page }, { retry: false }),
        );
        const row = rows.find((item) => item.id === message.id);
        if (row) return row.from?.name || row.from?.email || null;
        if (rows.length < 25) break;
      }
      return null;
    },
  });
  const read = useQuery(
    mail.read.queryOptions({ account, id: message.id, mailbox }, { enabled: reading, retry: false }),
  );
  return (
    <div className="flex flex-col gap-xs py-xs">
      <span className="text-label">{message.subject}</span>
      <span className="text-caption text-muted-foreground">
        {sender.data || copy.candidature.mail.unknownSender} · {message.date?.slice(0, 10)}
      </span>
      <button type="button" className="self-start underline" onClick={() => setReading(!reading)}>
        {copy.candidature.mail.read}: {message.subject}
      </button>
      {reading &&
        (read.isError ? (
          <p>{copy.candidature.mail.unknown}</p>
        ) : read.data ? (
          <p className="break-words whitespace-pre-wrap">{read.data.text}</p>
        ) : (
          <LoadingSkeleton label={copy.candidature.mail.loading} rows={3} />
        ))}
    </div>
  );
}

export function MailThread({
  answer,
  onRemove,
  links = [answer],
}: {
  answer: Answer;
  onRemove: (account: string, messageId: string) => Promise<void>;
  links?: Answer[];
}) {
  return (
    <li className="flex flex-col gap-xs border-b border-border py-sm">
      {answer.thread ? (
        <>
          <span className="text-caption text-muted-foreground">
            {answer.thread.waiting ? copy.candidature.mail.sent : copy.candidature.mail.received}
          </span>
          {answer.thread.messages.map((message) => (
            <ThreadMessage key={`${message.mailbox}:${message.id}`} account={answer.account} message={message} />
          ))}
        </>
      ) : (
        <p>
          {answer.status === 'timeout'
            ? copy.candidature.mail.timeout
            : answer.status === 'account'
              ? copy.candidature.mail.accountError
              : copy.candidature.mail.missing}
        </p>
      )}
      {links.map((link) => (
        <HoldButton
          key={`${link.account}:${link.messageId}`}
          {...copy.hold.mailLink(
            links.length > 1
              ? `${copy.candidature.mail.disconnect}: ${linkLabel(answer, link.messageId, links.indexOf(link))}`
              : copy.candidature.mail.disconnect,
          )}
          outline
          className="self-start"
          onConfirm={() => onRemove(link.account, link.messageId)}
        />
      ))}
    </li>
  );
}

/** Two links in one thread are told apart by their own message's subject, never by the raw Message-ID. */
function linkLabel(answer: Answer, messageId: string, index: number) {
  const subject = answer.thread?.messages.find((message) => message.messageId === messageId)?.subject.trim();
  return subject || `${index + 1}`;
}
