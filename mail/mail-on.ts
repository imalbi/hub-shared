/**
 * Whether Messaggi has mail to show, from the `mail.accounts` query. Before the first answer it counts as on (hiding on
 * a guess would flash the rail on every load); once the query has failed, a refetch started by another page puts it
 * back to `pending` with no data, and that must not bring the entry back for the length of the request.
 */
export function mailIsOn(query: { data: unknown; isPending: boolean; errorUpdateCount: number }) {
  return !!query.data || (query.isPending && query.errorUpdateCount === 0);
}
