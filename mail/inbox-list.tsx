import {
  ArchiveIcon,
  ArrowClockwiseIcon,
  EnvelopeOpenIcon,
  MagnifyingGlassIcon,
  StarIcon,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { AnimatedRow, AnimatedRows } from '../../apps/web/src/components/animated-list.tsx';
import { RegistryButton } from '../../apps/web/src/components/registry-button.tsx';
import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import { Input } from '../../apps/web/src/components/ui/input.tsx';
import { copy } from './copy.ts';
import { FilterChips, FilterPopover, activeFilters } from './filters.tsx';
import { mailDate } from './mail-date.ts';
import type { InboxRow, MailFilter } from './use-mail.ts';

export type InboxStatus = {
  rows: InboxRow[];
  pending: boolean;
  error: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  retry: () => Promise<unknown>;
  refresh: () => Promise<unknown>;
};

export const rowKey = (row: Pick<InboxRow, 'account' | 'id'>) => `${row.account}:${row.id}`;

/** The list panel: search, filters and refresh on top, the rows below, the next page read when the end shows. */
export function InboxList({
  status,
  filter,
  scope,
  onFilter,
  labels,
  showAccount,
  selected,
  onSelect,
  onToggleSeen,
  onArchive,
}: {
  status: InboxStatus;
  filter: MailFilter;
  /** Changes with the account or the search: the list below it starts over. */
  scope: string;
  onFilter: (next: MailFilter) => void;
  labels: Map<string, string>;
  showAccount: boolean;
  selected: string;
  onSelect: (row: InboxRow) => void;
  onToggleSeen: (row: InboxRow) => void;
  onArchive: (row: InboxRow) => void;
}) {
  const { rows } = status;
  const scroller = useRef<HTMLDivElement>(null);
  return (
    <section
      aria-label={copy.inbox}
      data-panel=""
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-md rounded-lg bg-muted pt-lg pb-0 pl-lg"
    >
      <div className="flex gap-xs pr-sm">
        <SearchField text={filter.body ?? ''} onSearch={(body) => onFilter({ ...filter, body })} />
        <FilterPopover filter={filter} onApply={onFilter} />
        <RegistryButton
          secondary
          iconOnly
          label={copy.refresh}
          icon={<ArrowClockwiseIcon aria-hidden />}
          action={async () => {
            // Back to the top: with the end in view the next pages would be read again at once.
            scroller.current?.scrollTo(0, 0);
            await status.refresh();
          }}
        />
      </div>
      {activeFilters(filter) > 0 && (
        <div className="flex flex-wrap gap-xs pr-sm">
          <FilterChips filter={filter} onChange={onFilter} />
        </div>
      )}
      <div
        // A new account or search is a new list, which starts at the top.
        key={scope}
        ref={scroller}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-sm pb-lg"
      >
        {status.error && (
          <div className="flex items-center justify-between gap-md">
            <p className="text-body text-muted-foreground">{copy.error}</p>
            <RegistryButton secondary label={copy.retry} action={status.retry} />
          </div>
        )}
        {status.pending && <ListSkeleton />}
        {!status.pending && !status.error && rows.length === 0 && <EmptyState title={copy.empty} />}
        <ul className="flex flex-col">
          <AnimatedRows>
            {rows.map((row) => (
              <AnimatedRow
                key={rowKey(row)}
                className="group relative border-b border-dashed border-border last:border-b-0"
              >
                <button
                  type="button"
                  aria-pressed={selected === rowKey(row)}
                  onClick={() => onSelect(row)}
                  className={`my-3xs flex w-full items-start gap-sm rounded-lg p-sm text-left ${selected === rowKey(row) ? 'bg-foreground/10' : 'hover:bg-foreground/5'}`}
                >
                  <span aria-hidden className={`mt-xs size-xs shrink-0 rounded-full ${row.seen ? '' : 'bg-primary'}`} />
                  <span className="flex min-w-0 flex-1 flex-col gap-3xs">
                    <span className="flex items-baseline justify-between gap-sm">
                      <span className={`truncate text-label ${row.seen ? 'text-muted-foreground' : ''}`}>
                        {row.from?.name || row.from?.email}
                      </span>
                      <span className="shrink-0 text-caption text-muted-foreground tabular-nums">
                        {mailDate(row.date)}
                      </span>
                    </span>
                    <span className={`flex items-center gap-xs text-body ${row.seen ? 'text-muted-foreground' : ''}`}>
                      <span className="truncate">{row.subject}</span>
                      {row.flagged && (
                        <>
                          <StarIcon aria-hidden weight="fill" className="size-icon-sm shrink-0" />
                          <span className="sr-only"> {copy.starred}</span>
                        </>
                      )}
                    </span>
                    {showAccount && (
                      <span className="text-caption text-muted-foreground">{labels.get(row.account)}</span>
                    )}
                  </span>
                  {!row.seen && <span className="sr-only"> {copy.unread}</span>}
                </button>
                <div className="absolute right-sm bottom-sm hidden gap-3xs group-focus-within:flex group-hover:flex">
                  <RowAction
                    label={(row.seen ? copy.markUnreadNamed : copy.markReadNamed)(row.subject)}
                    onClick={() => onToggleSeen(row)}
                  >
                    <EnvelopeOpenIcon aria-hidden weight={row.seen ? 'fill' : 'regular'} className="size-icon-sm" />
                  </RowAction>
                  <RowAction label={copy.archiveNamed(row.subject)} onClick={() => onArchive(row)}>
                    <ArchiveIcon aria-hidden className="size-icon-sm" />
                  </RowAction>
                </div>
              </AnimatedRow>
            ))}
          </AnimatedRows>
        </ul>
        {!status.pending && rows.length > 0 && <ListEnd status={status} />}
      </div>
    </section>
  );
}

function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-xl cursor-pointer items-center justify-center rounded-full bg-surface text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-accent"
    >
      {children}
    </button>
  );
}

/** Enter searches the text of the mail; emptying the field clears it. Filters live in their own popover. */
function SearchField({ text, onSearch }: { text: string; onSearch: (text: string | undefined) => void }) {
  const [draft, setDraft] = useState(text);
  return (
    <div className="min-w-0 flex-1">
      <Input
        aria-label={copy.searchLabel}
        placeholder={copy.searchPlaceholder}
        leading={<MagnifyingGlassIcon aria-hidden className="size-icon-sm" />}
        value={draft}
        maxLength={200}
        clearable
        clearLabel={copy.clearSearch}
        onValueChange={(next) => {
          setDraft(next);
          if (!next.trim()) onSearch(undefined);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSearch(draft.trim() || undefined);
        }}
      />
    </div>
  );
}

/** The loading row doubles as the sentinel: when it scrolls into view the next page is read. */
function ListEnd({ status }: { status: InboxStatus }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasMore, loadingMore, loadMore } = status;
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadMore();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, loadMore]);
  return (
    <div ref={sentinel} className="flex items-center justify-center p-md text-body text-muted-foreground">
      {hasMore ? copy.loadingMore : copy.end}
    </div>
  );
}

/** Placeholder rows shaped like the messages, so the list does not jump when it arrives. */
function ListSkeleton() {
  return (
    <output aria-label={copy.loading} className="flex flex-col">
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <span
          key={row}
          aria-hidden
          className="flex flex-col gap-xs border-b border-dashed border-border p-sm last:border-b-0 motion-safe:animate-pulse"
        >
          <span className="flex justify-between gap-sm">
            <span className="h-sm w-1/3 rounded-full bg-surface" />
            <span className="h-sm w-xl rounded-full bg-surface" />
          </span>
          <span className="h-sm w-2/3 rounded-full bg-surface" />
        </span>
      ))}
    </output>
  );
}
