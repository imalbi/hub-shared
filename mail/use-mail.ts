import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createTRPCOptionsProxy, useSubscription, type ofFeatureFlags } from '@trpc/tanstack-react-query';
import { createRouterClient } from '../../apps/web/src/lib/module-client.ts';
import { useModuleEnabled } from '../../apps/web/src/lib/module-enabled.ts';
import type { FeedRow } from './feed.ts';
import type { MailFilter } from './himalaya.ts';
import { mailIsOn } from './mail-on.ts';
import type { createMailRouter } from './router.ts';

// Named directly: the module's `create` returns an empty router when unconfigured, which would make the type a union.
export type MailRouter = ReturnType<typeof createMailRouter>;
export type { MailFilter };
export type InboxRow = FeedRow;
export const mailClient = createRouterClient<MailRouter>('mail');

export function useMailTRPC() {
  const queryClient = useQueryClient();
  return createTRPCOptionsProxy<MailRouter, ofFeatureFlags<{ keyPrefix: true }>>({
    client: mailClient,
    queryClient,
    keyPrefix: 'mail',
  });
}

/** The configured accounts, from the config only (no mail is read); an error means Posta is not configured. */
export function useMailAccounts(enabled = true) {
  const trpc = useMailTRPC();
  return useQuery({ ...trpc.accounts.queryOptions(undefined, { enabled }), retry: false, staleTime: Infinity });
}

export function useMail() {
  const trpc = useMailTRPC();
  return useSubscription(trpc.onState.subscriptionOptions());
}

export function useMailAvailable() {
  return mailIsOn(useMailAccounts(useModuleEnabled('mail')));
}
