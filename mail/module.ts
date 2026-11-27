import type { Run } from '../../apps/server/src/core/exec.ts';
import { defineModule, type NewMailEvent } from '../../apps/server/src/core/module.ts';
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
      const { accounts, notify } = config;
      const effectiveRun = overrideRun ?? run;
      const live = createMailLive(effectiveRun, accounts);
      const listeners = new Set<(event: NewMailEvent) => void>();
      let closed = false;
      let stopWatching: (() => Promise<void>) | undefined;
      function startWatching() {
        if (closed || stopWatching || accounts.length === 0) return;
        stopWatching = watchNewMail(live, effectiveRun, {
          notify,
          onNewMail(event) {
            for (const listener of listeners) {
              try {
                listener(event);
              } catch {
                log.warn('Mail listener failed');
              }
            }
          },
        });
      }
      if (notify) startWatching();
      capabilities.register('mail', {
        onNewMail(listener) {
          if (!closed) {
            listeners.add(listener);
            startWatching();
          }
          return () => {
            listeners.delete(listener);
            if (!notify && listeners.size === 0) {
              void stopWatching?.();
              stopWatching = undefined;
            }
          };
        },
        accounts: () => accounts,
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
          accounts,
          archiveMailbox: config.archiveMailbox,
          live,
          log,
        }),
        close: async () => {
          closed = true;
          listeners.clear();
          await stopWatching?.();
        },
      };
    },
  });
}

export const mailModule = createMailModule();
export type MailModuleDefinition = typeof mailModule;
