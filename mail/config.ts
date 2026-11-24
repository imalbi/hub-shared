import { z, type MailAccount } from '../../apps/server/src/core/module.ts';

// `account` is the himalaya account name (the table in its own config file, which Hub never reads); `label` is what the
// UI shows. Absent means off: no procedure answers and nothing polls.
export const configSchema = z
  .object({
    accounts: z
      .array(
        z.object({
          label: z
            .string()
            .trim()
            .min(1)
            .max(40)
            .meta({ title: 'Nome', description: "Come appare l'account nell'interfaccia." }),
          account: z
            .string()
            .min(1)
            .max(60)
            .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/)
            .meta({ title: 'Account himalaya', description: "Nome dell'account nella configurazione di himalaya." }),
        }),
      )
      .min(1)
      .max(10)
      .meta({
        title: 'Account di posta',
        description: 'Gli account da leggere; senza questa sezione la posta resta spenta.',
      }),
    archiveMailbox: z
      .string()
      .min(1)
      .max(100)
      .regex(/^[^\s-][^\0\r\n]*$/)
      .default('archive')
      .meta({
        title: 'Cartella archivio',
        description: 'Nome o alias in himalaya della cartella dove va "Archivia" (uguale per ogni account).',
      }),
    notify: z.boolean().default(true).meta({
      title: 'Notifica nuove mail',
      description: 'Una notifica sul desktop per ogni nuova mail non letta, anche con la pagina chiusa.',
    }),
  })
  .optional();

export type { MailAccount };
