import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createTRPCOptionsProxy, type ofFeatureFlags } from '@trpc/tanstack-react-query';
import type { MailAccount, MailMessage, MailThreadAnswer } from '../../apps/server/src/core/capabilities.ts';
import { useIsOn } from '../../apps/web/src/lib/module-enabled.ts';
import {
  createModuleClient,
  createRouterClient,
  type AnyTRPCRootTypes,
  type TRPCBuiltRouter,
  type TRPCQueryProcedure,
} from '../../apps/web/src/lib/module-client.ts';
import type definition from './server.ts';

export type MailFilterInput = {
  from?: string;
  subject?: string;
  body?: string;
  after?: string;
  unseen?: boolean;
};

type MailQuery<Input, Output> = TRPCQueryProcedure<{
  meta: unknown;
  input: Input;
  output: Output;
}>;

export type MailClientRouter = TRPCBuiltRouter<
  AnyTRPCRootTypes,
  {
    accounts: MailQuery<void, MailAccount[]>;
    search: MailQuery<{ account: string; mailbox?: string; filter: MailFilterInput; page?: number }, MailMessage[]>;
    read: MailQuery<{ account: string; mailbox?: string; id: string }, { text: string }>;
    threads: MailQuery<
      { links: { account: string; messageId: string }[] },
      { threads: MailThreadAnswer[]; truncated: boolean; after: string }
    >;
  }
>;

const client = createModuleClient<typeof definition>('lavoro');
const mailClient = createRouterClient<MailClientRouter>('mail');
export const linksKey = ['lavoro', 'mail-links'];

export function useMailTRPC() {
  const queryClient = useQueryClient();
  return createTRPCOptionsProxy<MailClientRouter, ofFeatureFlags<{ keyPrefix: true }>>({
    client: mailClient,
    queryClient,
    keyPrefix: 'mail',
  });
}

export function useMailAccounts() {
  const trpc = useMailTRPC();
  const mailOn = useIsOn()('mail');
  return useQuery({ ...trpc.accounts.queryOptions(undefined, { enabled: mailOn }), retry: false, staleTime: Infinity });
}

export function useApplicationLinks(key: string) {
  return useQuery({
    queryKey: [...linksKey, key],
    queryFn: () => client.links.list.query({ key }),
  });
}

export function useFirstResponse() {
  return useQuery({ queryKey: [...linksKey, 'first-response'], queryFn: () => client.links.firstResponse.query() });
}

export function useLinkedThreads(links: { account: string; messageId: string }[], enabled: boolean) {
  const mail = useMailTRPC();
  const cache = useQueryClient();
  return useQuery({
    queryKey: ['lavoro', 'mail-threads', links],
    enabled: enabled && links.length > 0,
    retry: false,
    queryFn: async (): Promise<MailThreadAnswer[]> => {
      const results = [];
      for (let i = 0; i < links.length; i += 50) {
        const batch = links.slice(i, i + 50).map(({ account, messageId }) => ({ account, messageId }));
        results.push(await cache.fetchQuery(mail.threads.queryOptions({ links: batch }, { retry: false })));
      }
      return results.flatMap((result) => result.threads);
    },
  });
}

export { client as lavoroMailClient };
