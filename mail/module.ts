import type { Run } from '../../apps/server/src/core/exec.ts';
import { defineModule } from '../../apps/server/src/core/module.ts';
import { router } from '../../apps/server/src/core/trpc.ts';
import { configSchema } from './config.ts';
import { himalaya, messageViewSchema, plainTextOf, readArgs } from './himalaya.ts';
import { createMailLive } from './live.ts';
import { watchNewMail } from './notify.ts';
import { createMailRouter, listThreadEntries } from './router.ts';
import { threadOf } from './thread.ts';

export function createMailModule({ run: overrideRun }: { run?: Run } = {}) {
  return defineModule({
    name: 'mail',
    provides: ['mail'],
    config: configSchema,
    create({ run, config, log, capabilities }) {
      // Absent means off: no accounts to read, so no procedure answers, no poller starts, and no capability publishes.
      if (!config) return { router: router({}) };
      const effectiveRun = overrideRun ?? run;
      const live = createMailLive(effectiveRun, config.accounts);
      const stopWatching = config.notify ? watchNewMail(live, effectiveRun) : undefined;
      capabilities.register('mail', {
        accounts: () => config.accounts,
        listThreadEntries: (account, after) => listThreadEntries(effectiveRun, account, after),
        readMessageText: async (account, mailbox, id) => {
          const result = await himalaya(effectiveRun, readArgs(account, mailbox, id), messageViewSchema);
          return result.ok ? plainTextOf(result.value) : null;
        },
        threadOf,
      });
      return {
        router: createMailRouter({
          run: effectiveRun,
          accounts: config.accounts,
          archiveMailbox: config.archiveMailbox,
          live,
          log,
        }),
        close: () => stopWatching?.(),
      };
    },
  });
}

export const mailModule = createMailModule();
export type MailModuleDefinition = typeof mailModule;
