import { buildServer as buildHubServer } from '../../apps/server/src/server.ts';
import { createMusicModule } from './server.ts';
export function buildServer({
  music,
  ...options
}: Parameters<typeof buildHubServer>[0] & { music?: Parameters<typeof createMusicModule>[0] }) {
  return buildHubServer({ ...options, deps: { ...options.deps, testModules: [createMusicModule(music)] } });
}
