import { useQueryClient } from '@tanstack/react-query';
import { createTRPCOptionsProxy, type ofFeatureFlags } from '@trpc/tanstack-react-query';
import { createModuleClient } from '../../apps/web/src/lib/module-client.ts';
import type { musicModule } from './server.ts';
export type MusicRouter = ReturnType<typeof musicModule.create>['router'];
const client = createModuleClient<typeof musicModule>('music');
export function useMusicTRPC() {
  return createTRPCOptionsProxy<MusicRouter, ofFeatureFlags<{ keyPrefix: true }>>({
    client,
    queryClient: useQueryClient(),
    keyPrefix: 'music',
  });
}
