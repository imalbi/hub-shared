import type { Run } from '../../apps/server/src/core/exec.ts';
import {
  TRPCError,
  z,
  type DiscoveredDeps,
  type MailMessage,
  type MailThreadAnswer,
} from '../../apps/server/src/core/module.ts';
import { loopbackProcedure, protectedProcedure, router } from '../../apps/server/src/core/trpc.ts';
import type { MailAccount } from './config.ts';
import { nextFeed } from './feed.ts';
import {
  bodySchema,
  capText,
  composeArgs,
  envelopesSchema,
  filterSchema,
  filterTokens,
  flagArgs,
  flagResultSchema,
  himalaya,
  himalayaDone,
  idSchema,
  listArgs,
  mailboxSchema,
  messageViewSchema,
  moveArgs,
  PAGE_SIZE,
  plainTextOf,
  queryValueSchema,
  readArgs,
  recipientsSchema,
  replyArgs,
  replyDraftArgs,
  replyDraftSchema,
  searchArgs,
  subjectSchema,
  THREAD_WINDOW,
  toMessage,
  type MailFailure,
  type MailResult,
} from './himalaya.ts';
import { readMailState, type MailLive, type MailState } from './live.ts';
import { threadOf, type ThreadEntry } from './thread.ts';

// Messages are never inbox-only for threads: the sent mailbox is the owner's side of the conversation.
const SENT = 'sent';
const INBOX = 'INBOX';
const MAX_IDS = 50;

// Each failure reads the same to the owner whatever himalaya said: no address, subject or body in the message.
function unwrap<T>(result: MailResult<T>): T {
  if (result.ok) return result.value;
  const errors: Record<MailFailure, TRPCError> = {
    timeout: new TRPCError({ code: 'TIMEOUT', message: 'The mail account did not answer in time' }),
    failed: new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'The mail account is not available' }),
    unreadable: new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'The mail account answered unexpectedly' }),
  };
  throw errors[result.failure];
}

/** Hub answers only for accounts in its own config; a name from the client is never passed to himalaya unchecked. */
function findAccount(accounts: readonly MailAccount[], name: string): MailAccount {
  const found = accounts.find((item) => item.account === name);
  if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'Mail account not configured' });
  return found;
}

const accountInput = z.string().min(1).max(60);
const pageInput = z.number().int().min(1).max(500).default(1);

/** Threads are built per account from both mailboxes; the window starts the day before `days` ago (`after` excludes its day). */
export function windowStart(days: number, now: Date): string {
  return new Date(now.getTime() - (days + 1) * 86_400_000).toISOString().slice(0, 10);
}

export async function listThreadEntries(
  run: Run,
  account: string,
  after: string,
): Promise<{ entries: ThreadEntry[]; truncated: boolean }> {
  const fetchSide = async (mailbox: string, side: 'inbox' | 'sent') => {
    const result = await himalaya(run, searchArgs(account, mailbox, 1, THREAD_WINDOW, { after }), envelopesSchema);
    const { envelopes } = unwrap(result);
    const entries = envelopes.map((envelope): ThreadEntry => {
      const message = toMessage(envelope);
      return {
        mailbox: side,
        id: message.id,
        messageId: message.messageId,
        inReplyTo: envelope['in-reply-to'],
        subject: message.subject,
        date: message.date,
        counterpart: (side === 'inbox' ? envelope.from[0]?.email : envelope.to[0]?.email)?.toLowerCase() ?? null,
      };
    });
    return { entries, truncated: envelopes.length >= THREAD_WINDOW };
  };
  const [inbox, sent] = await Promise.all([fetchSide(INBOX, 'inbox'), fetchSide(SENT, 'sent')]);
  return { entries: [...inbox.entries, ...sent.entries], truncated: inbox.truncated || sent.truncated };
}

/** A paired device gets the counts only: account names, labels, senders and subjects stay on the PC. */
function forClient(state: MailState, kind: string): MailState {
  if (kind === 'loopback') return state;
  return { accounts: state.accounts.map((account, index) => ({ ...account, ...anonymous(index), latest: [] })) };
}

const anonymous = (index: number) => ({ account: `#${index + 1}`, label: '' });

export type ThreadAnswer = MailThreadAnswer;

export function logThreadFailure(
  log: { warn: (fields: { kind: string; account: string }, message: string) => void },
  kind: Exclude<ThreadAnswer['status'], 'ok'>,
  account: string,
) {
  log.warn({ kind, account }, 'Mail thread unavailable');
}

// Offsets in the merged inbox cursor: far past any real mailbox, only a bound on the input.
const MAX_OFFSET = PAGE_SIZE * 500;

export function createMailRouter({
  run,
  accounts,
  archiveMailbox,
  live,
  log,
}: {
  run: Run;
  accounts: readonly MailAccount[];
  /** Name or alias in himalaya of the folder "Archivia" moves to. */
  archiveMailbox: string;
  live: MailLive;
  log: DiscoveredDeps['log'];
}) {
  const setFlag = (account: string, flag: 'seen' | 'flagged', ids: readonly string[], add: boolean) =>
    himalaya(run, flagArgs(account, INBOX, add, flag, ids), flagResultSchema);

  return router({
    // The deck shows the unread count (state); what the mail says stays on the PC (owner, 2026-11-09).
    // Cheap: answers from the config, so the UI may ask on every page whether Posta is configured.
    // A paired phone only learns how many accounts there are (the deck checks that Posta is on), not their names.
    accounts: protectedProcedure.query(({ ctx }) =>
      accounts.map(({ account, label }, index) =>
        ctx.client.kind === 'loopback' ? { account, label } : anonymous(index),
      ),
    ),
    state: protectedProcedure.query(async ({ ctx }) => forClient(await readMailState(run, accounts), ctx.client.kind)),
    refresh: protectedProcedure.input(z.object({})).query(async () => {
      await live.notify();
      return true;
    }),
    onState: protectedProcedure.subscription(async function* ({ ctx, signal }) {
      for await (const state of live.subscribe(signal)) yield forClient(state, ctx.client.kind);
    }),

    list: loopbackProcedure
      .input(z.object({ account: accountInput, mailbox: mailboxSchema.default(INBOX), page: pageInput }))
      .query(async ({ input }) => {
        const { account } = findAccount(accounts, input.account);
        const { envelopes } = unwrap(
          await himalaya(run, listArgs(account, input.mailbox, input.page, PAGE_SIZE), envelopesSchema),
        );
        return envelopes.map(toMessage);
      }),

    search: loopbackProcedure
      .input(
        z.object({
          account: accountInput,
          mailbox: mailboxSchema.default(INBOX),
          filter: filterSchema,
          page: pageInput,
        }),
      )
      .query(async ({ input }) => {
        const { account } = findAccount(accounts, input.account);
        const { envelopes } = unwrap(
          await himalaya(run, searchArgs(account, input.mailbox, input.page, PAGE_SIZE, input.filter), envelopesSchema),
        );
        return envelopes.map(toMessage);
      }),

    // The palette's records (step 64): subject matches in every account's inbox, newest first, cut to 3 with the count
    // (a lower bound when an account has more than one page). A failed account is left out while another answers.
    searchRecords: loopbackProcedure.input(z.object({ query: queryValueSchema })).query(async ({ input }) => {
      const settled = await Promise.all(
        accounts.map(async ({ account, label }) => {
          const result = await himalaya(
            run,
            searchArgs(account, INBOX, 1, PAGE_SIZE, { subject: input.query }),
            envelopesSchema,
          );
          return result.ok
            ? {
                ok: true as const,
                found: result.value.envelopes.map((envelope) => ({ ...toMessage(envelope), account, label })),
              }
            : result;
        }),
      );
      const answered = settled.flatMap((entry) => (entry.ok ? [entry.found] : []));
      const failed = settled.find((entry) => !entry.ok);
      if (failed && !failed.ok && answered.length === 0) unwrap(failed);
      const found = answered
        .flat()
        .toSorted((a, b) => (Date.parse(b.date ?? '') || 0) - (Date.parse(a.date ?? '') || 0));
      return { total: found.length, rows: found.slice(0, 3) };
    }),

    // The inbox of one account or of all of them merged (no `account`), a page at a time: the cursor is what the last
    // answer returned. Reading, replying and archiving then use each row's own `account`.
    inbox: loopbackProcedure
      .input(
        z.object({
          account: accountInput.optional(),
          filter: filterSchema.default({}),
          cursor: z.record(accountInput, z.number().int().min(0).max(MAX_OFFSET)).optional(),
        }),
      )
      .query(async ({ input }) => {
        const names =
          input.account === undefined
            ? accounts.map((item) => item.account)
            : [findAccount(accounts, input.account).account];
        const filtered = filterTokens(input.filter).length > 0;
        const result = await nextFeed(names, input.cursor ?? {}, PAGE_SIZE, async (account, page) => {
          const args = filtered
            ? searchArgs(account, INBOX, page, PAGE_SIZE, input.filter)
            : listArgs(account, INBOX, page, PAGE_SIZE);
          const listed = await himalaya(run, args, envelopesSchema);
          return listed.ok ? { ok: true, value: listed.value.envelopes.map(toMessage) } : listed;
        });
        return unwrap(result);
      }),

    // Never `--seen`: opening a message leaves it unread until the owner marks it.
    read: loopbackProcedure
      .input(z.object({ account: accountInput, id: idSchema, mailbox: mailboxSchema.default(INBOX) }))
      .query(async ({ input }) => {
        const { account } = findAccount(accounts, input.account);
        const view = unwrap(await himalaya(run, readArgs(account, input.mailbox, input.id), messageViewSchema));
        return { id: input.id, ...capText(plainTextOf(view)) };
      }),

    threads: loopbackProcedure
      .input(
        z.object({
          links: z
            .array(z.object({ account: accountInput, messageId: z.string().min(1).max(320) }))
            .min(1)
            .max(50),
          days: z.number().int().min(1).max(365).default(60),
        }),
      )
      .query(async ({ input }) => {
        const after = windowStart(input.days, new Date());
        const accountNames = [...new Set(input.links.map((link) => link.account))];
        const sides = await Promise.all(
          accountNames.map(async (name) => {
            const account = accounts.find((item) => item.account === name);
            if (!account) return [name, { status: 'account' as const, entries: [], truncated: false }] as const;
            try {
              const listing = await listThreadEntries(run, name, after);
              const missing = input.links.some(
                (link) => link.account === name && !threadOf(listing.entries, link.messageId),
              );
              if (missing) {
                const folders = unwrap(
                  await himalaya(
                    run,
                    ['--json', '-a', name, 'mailbox', 'list'],
                    z.object({
                      mailboxes: z.array(z.object({ id: mailboxSchema, name: z.string(), role: z.string().nullish() })),
                    }),
                  ),
                );
                // In parallel: each search is about 1.3 s on the owner's accounts and a mailbox has about ten folders.
                const found = await Promise.all(
                  folders.mailboxes
                    .filter(
                      (item) =>
                        !['inbox', 'sent'].includes(item.id.toLowerCase()) &&
                        !['inbox', 'sent'].includes(item.role ?? ''),
                    )
                    .map(async (folder) => ({
                      folder: folder.id,
                      envelopes: unwrap(
                        await himalaya(run, searchArgs(name, folder.id, 1, THREAD_WINDOW, { after }), envelopesSchema),
                      ).envelopes,
                    })),
                );
                for (const { folder, envelopes } of found) {
                  listing.truncated ||= envelopes.length >= THREAD_WINDOW;
                  listing.entries.push(
                    ...envelopes.map((envelope): ThreadEntry => {
                      const message = toMessage(envelope);
                      return {
                        mailbox: 'inbox',
                        folder,
                        id: message.id,
                        messageId: message.messageId,
                        inReplyTo: envelope['in-reply-to'],
                        subject: message.subject,
                        date: message.date,
                        counterpart: envelope.from[0]?.email?.toLowerCase() ?? null,
                      };
                    }),
                  );
                }
              }
              return [name, { ...listing, status: 'ok' as const }] as const;
            } catch (error) {
              return [
                name,
                {
                  status:
                    error instanceof TRPCError && error.code === 'TIMEOUT'
                      ? ('timeout' as const)
                      : ('account' as const),
                  entries: [],
                  truncated: false,
                },
              ] as const;
            }
          }),
        );
        const byAccount = new Map<
          string,
          { status: 'ok' | 'account' | 'timeout'; entries: readonly ThreadEntry[]; truncated: boolean }
        >(sides);
        const answers: ThreadAnswer[] = input.links.map((link) => {
          const side = byAccount.get(link.account);
          const entries = side?.entries ?? [];
          const legacy = entries.filter((entry) => entry.id === link.messageId && entry.messageId);
          const direct = threadOf(entries, link.messageId);
          const resolvedMessageId = !direct && legacy.length === 1 ? (legacy[0]?.messageId ?? undefined) : undefined;
          const thread = direct ?? (resolvedMessageId ? threadOf(entries, resolvedMessageId) : null);
          const status = side?.status !== 'ok' ? (side?.status ?? 'account') : thread ? 'ok' : 'missing';
          if (status !== 'ok')
            logThreadFailure(log, status, accounts.find((account) => account.account === link.account)?.label ?? '');
          return { ...link, thread, status, ...(resolvedMessageId && thread ? { resolvedMessageId } : {}) };
        });
        const truncated = sides.some(([, side]) => side.truncated);
        return { threads: answers, truncated, after };
      }),

    // himalaya builds the reply (recipients, `Re:`, the quote) and this only shows it; nothing is sent.
    replyDraft: loopbackProcedure
      .input(z.object({ account: accountInput, id: idSchema, mailbox: mailboxSchema.default(INBOX) }))
      .query(async ({ input }) => {
        const { account } = findAccount(accounts, input.account);
        const draft = unwrap(await himalaya(run, replyDraftArgs(account, input.mailbox, input.id), replyDraftSchema));
        return { to: draft.to, cc: draft.cc, subject: draft.subject ?? null, quoted: draft.body };
      }),

    // Sending needs the hold (`danger`) and the PC: an agent or a paired phone never gets here.
    reply: loopbackProcedure
      .meta({
        label: 'Rispondi a una mail',
        description: 'Send a reply to one message of a configured mail account',
        danger: true,
        pageOnly: true,
      })
      .input(
        z.object({
          account: accountInput,
          id: idSchema,
          mailbox: mailboxSchema.default(INBOX),
          body: bodySchema,
          to: recipientsSchema.min(1).optional(),
          cc: recipientsSchema.min(1).optional(),
          confirmed: z.literal(true),
        }),
      )
      .mutation(async ({ input }) => {
        const { account } = findAccount(accounts, input.account);
        unwrap(await himalayaDone(run, replyArgs(account, input.mailbox, input.id, input)));
        void live.notify();
      }),

    compose: loopbackProcedure
      .meta({
        label: 'Scrivi una mail',
        description: 'Send a new mail from one configured mail account to one or more recipients',
        danger: true,
        pageOnly: true,
      })
      .input(
        z.object({
          account: accountInput,
          to: recipientsSchema.min(1),
          cc: recipientsSchema.min(1).optional(),
          subject: subjectSchema.min(1),
          body: bodySchema,
          confirmed: z.literal(true),
        }),
      )
      .mutation(async ({ input }) => {
        const { account } = findAccount(accounts, input.account);
        unwrap(await himalayaDone(run, composeArgs(account, input)));
        void live.notify();
      }),

    archive: loopbackProcedure
      .meta({
        label: 'Archivia mail',
        pageOnly: true,
        description: 'Move one inbox message of a configured mail account to its archive folder (undoable)',
      })
      .input(z.object({ account: accountInput, id: idSchema }))
      .mutation(async ({ input }) => {
        const { account } = findAccount(accounts, input.account);
        unwrap(await himalayaDone(run, moveArgs(account, INBOX, archiveMailbox, [input.id])));
        void live.notify();
      }),

    // The archived message has a new id there, so it is found again by its Message-ID among the archive's listing for
    // its subject (shortcut: with no subject it is looked for in the newest page only).
    unarchive: loopbackProcedure
      .meta({
        label: 'Annulla archiviazione',
        pageOnly: true,
        description: 'Move a message back from the archive folder to the inbox, found by its Message-ID',
      })
      .input(z.object({ account: accountInput, messageId: z.string().min(1).max(320), subject: z.string().max(200) }))
      .mutation(async ({ input }) => {
        const { account } = findAccount(accounts, input.account);
        const filter = input.subject && /^[^\0\r\n]+$/.test(input.subject) ? { subject: input.subject } : {};
        const args =
          Object.keys(filter).length > 0
            ? searchArgs(account, archiveMailbox, 1, PAGE_SIZE, filter)
            : listArgs(account, archiveMailbox, 1, PAGE_SIZE);
        const listed = unwrap(await himalaya(run, args, envelopesSchema));
        const found: MailMessage | undefined = listed.envelopes
          .map(toMessage)
          .find((m) => m.messageId === input.messageId);
        if (!found) throw new TRPCError({ code: 'NOT_FOUND', message: 'The archived message was not found' });
        unwrap(await himalayaDone(run, moveArgs(account, archiveMailbox, INBOX, [found.id])));
        void live.notify();
      }),

    setSeen: protectedProcedure
      .meta({
        label: 'Segna come letta',
        description:
          'Mark mail messages in the inbox of one configured account as read, or as unread when seen is false',
      })
      .input(z.object({ account: accountInput, ids: z.array(idSchema).min(1).max(MAX_IDS), seen: z.boolean() }))
      .mutation(async ({ input }) => {
        const { account } = findAccount(accounts, input.account);
        unwrap(await setFlag(account, 'seen', input.ids, input.seen));
        void live.notify();
      }),

    setFlagged: protectedProcedure
      .meta({
        label: 'Contrassegna',
        description: 'Star or unstar mail messages in the inbox of one configured account (the flagged flag)',
      })
      .input(z.object({ account: accountInput, ids: z.array(idSchema).min(1).max(MAX_IDS), flagged: z.boolean() }))
      .mutation(async ({ input }) => {
        const { account } = findAccount(accounts, input.account);
        unwrap(await setFlag(account, 'flagged', input.ids, input.flagged));
        void live.notify();
      }),
  });
}
