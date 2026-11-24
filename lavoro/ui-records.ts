import { createModuleClient } from '../../apps/web/src/lib/module-client.ts';
import type { RecordSource } from '../../apps/web/src/lib/module-ui.ts';
import { copy } from './copy.ts';
import type definition from './server.ts';
import { daysSince } from './waiting.ts';

const client = createModuleClient<typeof definition>('lavoro');
const ZONE = '/desk/ricerca';

// The links are the ones the pages already have: `?job=<key>` opens the posting's detail over any tab, `segment` is the
// Annunci tab it sits in, and the Candidature page has its own `tab` (see `annunciSearchSchema` in ui-common.tsx).
const postingHref = (key: string, segment: string) => `${ZONE}?${new URLSearchParams({ segment, job: key })}`;
const applicationHref = (key: string) => `${ZONE}?${new URLSearchParams({ tab: 'candidature', job: key })}`;

function sentLabel(appliedAt: number) {
  const { today, yesterday, days_ago } = copy.candidature.card;
  const days = daysSince(appliedAt, Date.now());
  return `${copy.records.sent} ${days === 0 ? today : days === 1 ? yesterday : days_ago(days)}`;
}

/** Postings without an application: "<azienda> · <luogo> · <scheda>", the opinion and the score as badges. */
export const lavoroPostings: RecordSource = {
  id: 'lavoro-postings',
  label: () => copy.tab_annunci,
  get: async (id, signal) => {
    const job = await client.searchRecords.get.query({ key: id }, { signal });
    if (!job) return null;
    return {
      id,
      title: job.title,
      detail: [job.company, job.location].filter(Boolean).join(' · '),
      href: job.tab === 'applications' ? applicationHref(id) : postingHref(id, job.tab),
    };
  },
  allHref: (query) => `${ZONE}?${new URLSearchParams({ q: query })}`,
  search: async (query, signal) => {
    const { total, rows } = await client.searchRecords.postings.query({ query }, { signal });
    return {
      total,
      rows: rows.map((row) => ({
        id: row.key,
        title: row.title,
        detail: [row.company, row.location, copy.segments[row.segment]].filter(Boolean).join(' · '),
        badges: [...(row.possibility ? [copy.possibility[row.possibility]] : []), String(row.score)],
        href: postingHref(row.key, row.segment),
      })),
    };
  },
};

/** Applications: "<azienda> · inviata N giorni fa", the status as the badge. */
export const lavoroApplications: RecordSource = {
  id: 'lavoro-applications',
  label: () => copy.tab_candidature,
  get: async (id, signal) => {
    const job = await client.searchRecords.get.query({ key: id }, { signal });
    return job?.tab === 'applications'
      ? { id, title: job.title, detail: job.company, href: applicationHref(id) }
      : null;
  },
  allHref: (query) => `${ZONE}?${new URLSearchParams({ tab: 'candidature', candidature: 'all', q: query })}`,
  search: async (query, signal) => {
    const { total, rows } = await client.searchRecords.applications.query({ query }, { signal });
    return {
      total,
      rows: rows.map((row) => ({
        id: row.key,
        title: row.title,
        detail: `${row.company} · ${sentLabel(row.appliedAt)}`,
        badges: [copy.candidature.status[row.status]],
        href: applicationHref(row.key),
      })),
    };
  },
};
