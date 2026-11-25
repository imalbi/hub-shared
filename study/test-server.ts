import { buildServer as buildHubServer } from '../../apps/server/src/server.ts';
import base from './server.ts';
export function buildServer(options: Parameters<typeof buildHubServer>[0]) {
  const config = options.config?.modules?.study;
  return buildHubServer({
    ...options,
    deps: {
      ...options.deps,
      testModules: [
        {
          ...base,
          create(deps) {
            return base.create({ ...deps, config });
          },
        },
      ],
    },
  });
}
