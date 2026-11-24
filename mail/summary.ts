export function summarizeMail(accounts: readonly { unread: number | null; capped: boolean }[]) {
  return {
    count: accounts.some((account) => account.unread === null)
      ? null
      : accounts.reduce((sum, account) => sum + (account.unread ?? 0), 0),
    capped: accounts.some((account) => account.capped),
  };
}

const timeFormat = new Intl.DateTimeFormat('it-IT', { hour: '2-digit', minute: '2-digit' });

function parseDateMs(date: string | null): number {
  const ms = date ? Date.parse(date) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.NaN;
}

/** Up to `max` newest messages across accounts, annotated with their source account id. */
export function recentMail<T extends { date: string | null }>(
  accounts: readonly { account: string; latest: readonly T[] }[],
  max: number,
): Array<T & { account: string }> {
  return accounts
    .flatMap((entry) => entry.latest.map((message) => ({ ...message, account: entry.account })))
    .toSorted((a, b) => {
      const ta = parseDateMs(a.date);
      const tb = parseDateMs(b.date);
      if (!Number.isNaN(ta) && !Number.isNaN(tb)) return tb - ta;
      if (!Number.isNaN(tb)) return 1;
      if (!Number.isNaN(ta)) return -1;
      return (b.date ?? '').localeCompare(a.date ?? '');
    })
    .slice(0, max);
}

/** Display sender label from an envelope's `from` field. */
export function mailSender(from: { name?: string | null; email?: string | null } | null | undefined): string {
  return from?.name || from?.email || '';
}

/** Formats an email timestamp as `HH:mm`, returning `''` when absent or invalid. */
export function mailTime(date: string | null): string {
  const ms = parseDateMs(date);
  return Number.isNaN(ms) ? '' : timeFormat.format(ms);
}
