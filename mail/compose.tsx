import { XIcon } from '@phosphor-icons/react';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { HoldButton } from '../../apps/web/src/components/hold-button.tsx';
import { Input } from '../../apps/web/src/components/ui/input.tsx';
import { Select } from '../../apps/web/src/components/ui/select.tsx';
import { TagInput, type TagInputTag } from '../../apps/web/src/components/ui/tag-input.tsx';
import { Textarea } from '../../apps/web/src/components/ui/textarea.tsx';
import { z } from '../../apps/web/src/lib/zod-csp.ts';
import { tagCopy } from '../../apps/web/src/settings/field-copy.ts';
import { copy } from './copy.ts';
import { useMailTRPC } from './use-mail.ts';

const address = z.email();
const BODY_MAX = 20_000;

export const toTags = (addresses: readonly string[]): TagInputTag[] => addresses.map((value) => ({ id: value, value }));
export const valid = (tags: readonly TagInputTag[]) => tags.filter((tag) => !tag.error).map((tag) => tag.value);

/** One address row: its label at the left, chips for the addresses, each checked as an address. */
export function AddressRow({
  label,
  tags,
  onChange,
}: {
  label: string;
  tags: TagInputTag[];
  onChange: (tags: TagInputTag[]) => void;
}) {
  return (
    <div className="flex items-start gap-sm">
      <span className="w-label-col shrink-0 pt-sm text-body text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">
        <TagInput
          label={label}
          copy={tagCopy}
          allowCreate
          normalize={(value) => value.trim().toLowerCase()}
          validate={(value) => (address.safeParse(value).success ? null : copy.addressInvalid)}
          value={tags}
          onValueChange={onChange}
        />
      </div>
    </div>
  );
}

/** The hold that sends. A form problem throws before any request, so the hold shows its error and nothing is sent. */
export function SendHold({
  name,
  onSend,
  onError,
}: {
  name: string;
  /** Returns the form's problem as a line, or sends and resolves. */
  onSend: () => Promise<string | null>;
  onError: (line: string | null) => void;
}) {
  return (
    <HoldButton
      label={name}
      idle={copy.sendHold}
      done={copy.sendDone}
      onConfirm={async () => {
        onError(null);
        // A failed request reads the same whatever the server said: one Italian line, the form and its text stay.
        const problem = await onSend().catch(() => copy.sendError);
        if (problem) {
          onError(problem);
          throw new Error(problem);
        }
      }}
    />
  );
}

/** The body takes focus when the form opens, so the owner can type at once. */
export function BodyField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => field.current?.focus(), []);
  return (
    <Textarea
      aria-label={label}
      minRows={5}
      maxRows={10}
      maxLength={BODY_MAX}
      showCount={false}
      // The field's own 13.5px is for a form; a letter reads at the body size.
      textareaClassName="sm:text-body!"
      value={value}
      onValueChange={onChange}
      ref={field}
    />
  );
}

/** "Nuova mail": the same form as a reply with every field empty. Closed by the X, or by the parent once sent. */
export function ComposeForm({
  accounts,
  defaultAccount,
  onClose,
  onSent,
}: {
  accounts: { account: string; label: string }[];
  defaultAccount: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const trpc = useMailTRPC();
  const compose = useMutation(trpc.compose.mutationOptions());
  const [account, setAccount] = useState(defaultAccount);
  const [to, setTo] = useState<TagInputTag[]>([]);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  async function send() {
    const recipients = valid(to);
    if (to.some((tag) => tag.error)) return copy.addressInvalid;
    if (recipients.length === 0) return copy.recipientsMissing;
    if (!subject.trim()) return copy.subjectMissing;
    if (!body.trim()) return copy.bodyMissing;
    await compose.mutateAsync({ account, to: recipients, subject: subject.trim(), body, confirmed: true });
    onSent();
    return null;
  }
  return (
    <form
      aria-label={copy.newMail}
      onSubmit={(event) => event.preventDefault()}
      className="flex min-h-0 flex-1 flex-col gap-md overflow-y-auto overscroll-contain"
    >
      <div className="flex items-center justify-between gap-md">
        <h2 className="text-title">{copy.newMail}</h2>
        <button
          type="button"
          aria-label={copy.close}
          onClick={onClose}
          className="flex size-touch cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-surface hover:text-foreground focus-visible:outline focus-visible:outline-accent"
        >
          <XIcon aria-hidden className="size-icon" />
        </button>
      </div>
      <div className="flex items-center gap-sm border-b border-dashed border-border pb-md">
        <span className="w-label-col shrink-0 text-body text-muted-foreground">{copy.fromAccount}</span>
        <Select
          label={copy.fromAccount}
          hideLabel
          options={accounts.map((item) => ({ value: item.account, label: item.label }))}
          value={account}
          onValueChange={setAccount}
        />
      </div>
      <AddressRow label={copy.to} tags={to} onChange={setTo} />
      <div className="flex items-center gap-sm">
        <span className="w-label-col shrink-0 text-body text-muted-foreground">{copy.subject}</span>
        <div className="min-w-0 flex-1">
          <Input aria-label={copy.subject} value={subject} onValueChange={setSubject} maxLength={300} />
        </div>
      </div>
      <BodyField label={copy.composeText} value={body} onChange={setBody} />
      <div className="flex items-center gap-md">
        <SendHold name={copy.sendNewName} onSend={send} onError={setProblem} />
        <span className="ml-auto text-caption text-muted-foreground">{copy.saveCopy}</span>
      </div>
      {problem && (
        <p role="alert" className="text-body text-danger">
          {problem}
        </p>
      )}
    </form>
  );
}
