import { defineModule, z } from '../../../../../apps/server/src/core/module.ts';
import type { Run } from '../../../../../apps/server/src/core/exec.ts';
import { createFakeMailRun } from '../../../fake-himalaya.ts';
import { mailModule } from '../../../module.ts';

const defaultConfig = {
  accounts: [
    { account: 'work', label: 'Lavoro' },
    { account: 'personal', label: 'Personale' },
  ],
  archiveMailbox: 'archive',
  notify: true,
};

const failBodySchema = z.object({ fail: z.boolean() });

export default defineModule({
  name: mailModule.name,
  provides: mailModule.provides,
  config: z.unknown(),
  create(deps) {
    const calls: string[][] = [];
    let failMail = false;
    const baseRun = createFakeMailRun({ calls });
    const run: Run = (bin, args, options) => {
      if (
        failMail &&
        bin === 'himalaya' &&
        ((args.includes('envelope') && args.includes('25')) || args.includes('--send'))
      ) {
        return Promise.resolve({ stdout: '', stderr: '', code: 1 });
      }
      return baseRun(bin, args, options);
    };
    const instance = mailModule.create({
      ...deps,
      run,
      config: deps.config ?? defaultConfig,
    });
    return {
      ...instance,
      routes(scope) {
        scope.get('/fake-calls', () => ({ calls }));
        scope.post('/fake-fail', (request, reply) => {
          const parsed = failBodySchema.safeParse(request.body);
          if (!parsed.success) return reply.code(400).send();
          failMail = parsed.data.fail;
          return { fail: failMail };
        });
      },
    };
  },
});
