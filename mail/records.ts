import type { RecordSource } from '../../apps/web/src/lib/module-ui.ts';
import { copy } from './copy.ts';
import { rowKey } from './inbox-list.tsx';
import { mailDate } from './mail-date.ts';
import { postaHref } from './search.ts';
import { mailClient } from './use-mail.ts';

/** Posta in the palette (step 64): subjects of every inbox, matched by himalaya on the server, 3 newest rows and the count. */
export const mailMessages: RecordSource = {
  id: 'mail-messages',
  label: () => copy.title,
  allHref: (query) => postaHref(query),
  search: async (query, signal) => {
    const { total, rows } = await mailClient.searchRecords.query({ query }, { signal });
    return {
      total,
      rows: rows.map((row) => ({
        id: rowKey(row),
        title: row.subject,
        detail: [row.from?.name || row.from?.email, mailDate(row.date), row.label].filter(Boolean).join(' · '),
        href: postaHref(row.subject, rowKey(row)),
      })),
    };
  },
};
