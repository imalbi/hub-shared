import type { MailMessage, MailResult } from './himalaya.ts';

export type FeedRow = MailMessage & { account: string };
/** Rows already delivered per account: a cursor that stays valid whichever accounts the next call merges. */
export type FeedCursor = Record<string, number>;
export type FetchPage = (account: string, page: number) => Promise<MailResult<MailMessage[]>>;

// Extra pages one call may read to fill itself when an account's rows are all older than the rest.
const MAX_EXTRA_FETCHES = 6;

type Side = {
  account: string;
  page: number;
  /** Rows of the first page already delivered by an earlier call. */
  skip: number;
  /** Rows with a sort time that never rises down the listing, so the delivered ones stay a prefix of it. */
  rows: { row: MailMessage; time: number }[];
  /** Sort time of the last row read of this account, across pages. */
  last: number;
  exhausted: boolean;
};

const timeOf = (message: MailMessage) => {
  const time = message.date ? Date.parse(message.date) : Number.NaN;
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
};
// Everything an account has not handed over yet is at most this old; an account with nothing loaded could hold anything.
const unseenBefore = (side: Side) => {
  const last = side.rows.at(-1);
  return last ? last.time : Number.POSITIVE_INFINITY;
};

/**
 * The next `size` rows of several inboxes merged newest first. Each account is listed a page at a time, and a row is
 * handed over only when no account that still has pages could hold a newer one: that is, when it is not older than the
 * newest of the "unseen before" limits of those accounts (the last row each has loaded). What was loaded and not handed over is read again by the
 * next call, which is why the cursor is a count per account and nothing is kept on the server. One failed account
 * fails the whole call (shortcut: a partial inbox would hide mail silently; revisit if one account is often down).
 */
export async function nextFeed(
  accounts: readonly string[],
  cursor: FeedCursor,
  size: number,
  fetchPage: FetchPage,
): Promise<MailResult<{ rows: FeedRow[]; cursor: FeedCursor | null }>> {
  const sides: Side[] = accounts.map((account) => ({
    account,
    page: Math.floor((cursor[account] ?? 0) / size) + 1,
    skip: (cursor[account] ?? 0) % size,
    rows: [],
    last: Number.POSITIVE_INFINITY,
    exhausted: false,
  }));

  async function load(side: Side): Promise<MailResult<true>> {
    const result = await fetchPage(side.account, side.page);
    if (!result.ok) return result;
    const timed = result.value.map((row) => {
      const own = timeOf(row);
      // An undated row sorts as its predecessor (as the oldest when it opens the listing).
      const time =
        own === Number.NEGATIVE_INFINITY
          ? side.last === Number.POSITIVE_INFINITY
            ? own
            : side.last
          : Math.min(own, side.last);
      side.last = time;
      return { row, time };
    });
    side.rows.push(...timed.slice(side.skip));
    side.skip = 0;
    side.exhausted = result.value.length < size;
    side.page++;
    return { ok: true, value: true };
  }

  for (const side of sides) {
    const loaded = await load(side);
    if (!loaded.ok) return loaded;
  }
  for (let extra = 0; ; extra++) {
    const open = sides.filter((side) => !side.exhausted);
    const blocking = open.toSorted((a, b) => unseenBefore(b) - unseenBefore(a))[0];
    const bound = blocking ? unseenBefore(blocking) : Number.NEGATIVE_INFINITY;
    const merged = sides
      .flatMap((side) => side.rows.map(({ row, time }) => ({ row: { ...row, account: side.account }, time })))
      .toSorted((a, b) => b.time - a.time);
    const eligible = merged.filter((entry) => entry.time >= bound).map((entry) => entry.row);
    // Too few rows are safe yet: read on from the account that sets the bound.
    if (blocking && eligible.length < size && extra < MAX_EXTRA_FETCHES) {
      const loaded = await load(blocking);
      if (!loaded.ok) return loaded;
      continue;
    }
    const rows = eligible.slice(0, size);
    const delivered: FeedCursor = {};
    let more = false;
    for (const side of sides) {
      const taken = rows.filter((row) => row.account === side.account).length;
      delivered[side.account] = (cursor[side.account] ?? 0) + taken;
      more ||= !side.exhausted || taken < side.rows.length;
    }
    return { ok: true, value: { rows, cursor: more ? delivered : null } };
  }
}
