import { useQueryClient } from '@tanstack/react-query';
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query';
import { createModuleClient } from '../../apps/web/src/lib/module-client.ts';
import type definition from './server.ts';
const client = createModuleClient<typeof definition>('weather');
export function useWeatherTRPC() {
  return createTRPCOptionsProxy<ReturnType<typeof definition.create>['router'], { keyPrefix: true }>({
    client,
    queryClient: useQueryClient(),
    keyPrefix: 'weather',
  });
}
