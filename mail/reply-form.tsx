import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LoadingSkeleton } from '../../apps/web/src/components/ui/loading-skeleton.tsx';
import type { TagInputTag } from '../../apps/web/src/components/ui/tag-input.tsx';
import { AddressRow, BodyField, SendHold, toTags, valid } from './compose.tsx';
import { copy } from './copy.ts';
import { useMailTRPC } from './use-mail.ts';

type Draft = { to: string[]; cc: string[]; subject: string | null; quoted: string };

/** The form under a message: recipients, `Re:` subject and quote come from himalaya, the owner writes above the quote. */
export function ReplyForm({
  account,
  accountLabel,
  id,
  onClose,
  onSent,
}: {
  account: string;
  accountLabel: string;
  id: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const trpc = useMailTRPC();
  const draft = useQuery(trpc.replyDraft.queryOptions({ account, id }, { retry: false, gcTime: 0 }));
  if (draft.isError) return <p className="text-body text-danger">{copy.error}</p>;
  if (!draft.data) return <LoadingSkeleton label={copy.replyLoading} rows={5} />;
  return (
    <ReplyFields
      draft={draft.data}
      account={account}
      accountLabel={accountLabel}
      id={id}
      onClose={onClose}
      onSent={onSent}
    />
  );
}

// Mounted once the draft is there, so the fields start from it without an effect copying it into state.
function ReplyFields({
  draft,
  account,
  accountLabel,
  id,
  onClose,
  onSent,
}: {
  draft: Draft;
  account: string;
  accountLabel: string;
  id: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const trpc = useMailTRPC();
  const reply = useMutation(trpc.reply.mutationOptions());
  const [to, setTo] = useState<TagInputTag[]>(() => toTags(draft.to));
  const [cc, setCc] = useState<TagInputTag[]>(() => toTags(draft.cc));
  const [showCc, setShowCc] = useState(draft.cc.length > 0);
  const [body, setBody] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const quotedLines = draft.quoted.split('\n').length;
  async function send() {
    if ([...to, ...cc].some((tag) => tag.error)) return copy.addressInvalid;
    if (valid(to).length === 0) return copy.recipientsMissing;
    if (!body.trim()) return copy.bodyMissing;
    await reply.mutateAsync({
      account,
      id,
      body,
      to: valid(to),
      cc: valid(cc).length > 0 ? valid(cc) : undefined,
      confirmed: true,
    });
    onSent();
    return null;
  }
  return (
    <form
      aria-label={copy.reply}
      onSubmit={(event) => event.preventDefault()}
      className="flex min-h-0 flex-1 flex-col gap-md overflow-y-auto overscroll-contain"
    >
      <div className="flex items-start gap-xs">
        <div className="min-w-0 flex-1">
          <AddressRow label={copy.to} tags={to} onChange={setTo} />
        </div>
        {!showCc && (
          <button
            type="button"
            onClick={() => setShowCc(true)}
            className="min-h-touch cursor-pointer rounded-full px-md text-label text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-accent"
          >
            {copy.addCc}
          </button>
        )}
      </div>
      {showCc && <AddressRow label={copy.cc} tags={cc} onChange={setCc} />}
      <p className="flex items-center gap-sm text-body">
        <span className="w-label-col shrink-0 text-muted-foreground">{copy.subject}</span>
        {draft.subject}
      </p>
      <BodyField label={copy.replyText} value={body} onChange={setBody} />
      <details className="text-caption text-muted-foreground">
        <summary className="cursor-pointer">{copy.quoted(quotedLines)}</summary>
        <p className="mt-sm break-words whitespace-pre-wrap">{draft.quoted}</p>
      </details>
      <div className="flex items-center gap-md">
        <SendHold name={copy.sendReplyName} onSend={send} onError={setProblem} />
        <button
          type="button"
          onClick={onClose}
          className="min-h-touch cursor-pointer rounded-full border border-border px-lg text-label hover:bg-surface focus-visible:outline focus-visible:outline-accent"
        >
          {copy.cancel}
        </button>
        <span className="ml-auto text-caption text-muted-foreground">{copy.replyVia(accountLabel)}</span>
      </div>
      {problem && (
        <p role="alert" className="text-body text-danger">
          {problem}
        </p>
      )}
    </form>
  );
}
