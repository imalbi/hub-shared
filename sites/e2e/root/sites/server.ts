import { defineModule, z } from '../../../../../apps/server/src/core/module.ts';
import base from '../../../server.ts';
import { recordCheck } from '../../../sites.ts';
export default defineModule({
  name: base.name,
  migrations: base.migrations,
  config: z.unknown(),
  settingsSchema: base.config,
  create(deps) {
    const count = deps.db.$client.prepare('select count(*) as n from site_days').get();
    if (count?.n === 0) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(12, 0, 0, 0);
      recordCheck(deps.db, 'https://example.com/down', {
        at: yesterday.getTime(),
        status: 503,
        latency: 10,
        error: null,
      });
    }

    return base.create({
      ...deps,
      config: deps.config ?? [
        { name: 'Sito pronto', url: 'https://example.com/up' },
        { name: 'Sito non raggiungibile', url: 'https://example.com/down' },
      ],
      fetch: async (input) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        return new Response(null, { status: url.endsWith('/down') ? 503 : 200 });
      },
    });
  },
});
