import { fileURLToPath } from 'node:url';
import { defineModule, z } from '../../apps/server/src/core/module.ts';
import { createLiveHub } from '../../apps/server/src/core/live.ts';
import { agentOrLoopbackProcedure, protectedProcedure, router } from '../../apps/server/src/core/trpc.ts';
import { probe, readSites, recordCheck } from './sites.ts';

export const sitesModule = defineModule({
  name: 'sites',
  migrations: fileURLToPath(new URL('./drizzle', import.meta.url)),
  config: z
    .array(
      z.object({
        name: z.string().trim().min(1).meta({ title: 'Nome', description: 'Nome mostrato per il sito.' }),
        url: z.url().meta({ manual: true, title: 'Indirizzo', description: 'Indirizzo del sito da controllare.' }),
      }),
    )
    .default([])
    .meta({ title: 'Siti', description: 'Siti controllati; lascia vuoto per non controllarne nessuno.' }),
  create({ config, db, fetch, log }) {
    const read = async () => readSites(db, config);
    const live = createLiveHub(read, null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    async function poll() {
      const started = Date.now();
      try {
        const checks = await Promise.all(config.map((site) => probe(fetch, site.url)));
        for (let index = 0; index < config.length; index++) {
          const site = config[index];
          const check = checks[index];
          if (site && check) recordCheck(db, site.url, check);
        }
        await live.notify();
      } catch {
        log.warn('Site checks could not be stored');
      }
      if (!closed && config.length)
        timer = setTimeout(
          () => {
            pending = poll();
          },
          Math.max(0, 5 * 60_000 - (Date.now() - started)),
        );
    }
    let pending = poll();
    return {
      router: router({
        // Answered from the config, so the web can decide whether Siti is on without waiting for a check.
        configured: protectedProcedure.query(() => config.length > 0),
        // Names and URLs stay on the PC and its agents: the deck reads only `configured`.
        state: agentOrLoopbackProcedure.query(async () => {
          await pending;
          return read();
        }),
        onState: agentOrLoopbackProcedure.subscription(({ signal }) => live.subscribe(signal)),
      }),
      close: async () => {
        closed = true;
        clearTimeout(timer);
        await pending;
      },
    };
  },
});

export default sitesModule;
