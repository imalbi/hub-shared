import { zoneSearch } from '../../apps/web/src/lib/zone-search.ts';
import { z } from '../../apps/web/src/lib/zod-csp.ts';

/**
 * What a palette link tells Posta (step 64): `message` is `<account>:<id>` of the row to open, `subject` the search to
 * show it in. A value that is not a string is dropped, never an error (a stale link must still open the page).
 */
export const postaSearch = zoneSearch.extend({
  message: z.string().optional().catch(undefined),
  subject: z.string().optional().catch(undefined),
});

/** The Posta page with `subject` searched and, when given, one message selected. */
export function postaHref(subject: string, message?: string) {
  const search = new URLSearchParams({ tab: 'mail', subject });
  if (message) search.set('message', message);
  return `/desk/messaggi?${search}`;
}
