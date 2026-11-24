import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMailAccounts, useMailTRPC } from '../../apps/web/src/modules/mail/use-mail.ts';
import { createModuleClient } from '../../apps/web/src/lib/module-client.ts';
import type definition from './server.ts';
import type { ThreadAnswer } from '../../apps/server/src/modules/mail/router.ts';

const client = createModuleClient<typeof definition>('lavoro');
export const linksKey = ['lavoro', 'mail-links'];

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
    queryFn: async (): Promise<ThreadAnswer[]> => {
      const results = [];
      for (let i = 0; i < links.length; i += 50) {
        const batch = links.slice(i, i + 50).map(({ account, messageId }) => ({ account, messageId }));
        results.push(await cache.fetchQuery(mail.threads.queryOptions({ links: batch }, { retry: false })));
      }
      return results.flatMap((result) => result.threads);
    },
  });
}

export { client as lavoroMailClient, useMailAccounts };
