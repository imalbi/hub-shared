import { HoldButton } from '../../apps/web/src/components/hold-button.tsx';
import { LoadingSkeleton } from '../../apps/web/src/components/ui/loading-skeleton.tsx';
import { NumberRoll } from '../../apps/web/src/components/ui/number-roll.tsx';
import { AnimatedItem, AnimatedRows } from '../../apps/web/src/components/animated-list.tsx';
import * as React from 'react';
import { ActionButton } from '../../apps/web/src/components/ui/action-button.tsx';
import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import { copy } from './copy.ts';
import type { JobRow, RuleRow } from './server.ts';
import type { PostingGroup, PostingGroupId } from './sort.ts';
import type { UserState } from './tabs.ts';
import { PostingCard, PostingRow } from './ui-card-row.tsx';
import { emptyDescBySegment, emptyTitleBySegment, type AnnunciSegment, type ViewOptions } from './ui-common.tsx';

export type PostingsListProps = {
  currentSegment: AnnunciSegment;
  hasActiveFilters: boolean;
  listError: boolean;
  /** False until the first list arrives: an empty list before that is not "no postings". */
  loaded: boolean;
  filteredJobs: JobRow[];
  allJobsCount: number;
  pagedJobs: JobRow[];
  sortedJobsCount: number;
  pageLimit: number;
  viewOpts: ViewOptions;
  now: number;
  rules: RuleRow[];
  userState: UserState;
  isGlobe: boolean;
  highlightTermsList: string[];
  /** Set with the opinion sort in "Da valutare": the cards are then drawn per group. */
  groups: PostingGroup[] | null;
  openGroups: ReadonlySet<PostingGroupId>;
  onToggleGroup: (id: PostingGroupId) => void;
  onOpenDetail: (key: string) => void;
  onSetFlag: (
    keys: string[],
    flag: 'archived' | 'deleted' | 'applied',
    value: boolean,
    toastMsg: string,
    reverseMsg: string,
  ) => Promise<void>;
  onPurge: (keys: string[]) => void;
  onIncludeAgain?: (key: string) => Promise<void>;
  onGroupConfirm: (confirm: { action: 'archive' | 'restore'; keys: string[] }) => void;
  onRetry: () => void;
  onResetFilters: () => void;
  onLoadMore: () => void;
};

export function PostingsList({
  currentSegment,
  hasActiveFilters,
  listError,
  loaded,
  filteredJobs,
  allJobsCount,
  pagedJobs,
  sortedJobsCount,
  pageLimit,
  viewOpts,
  now,
  rules,
  userState,
  isGlobe,
  highlightTermsList,
  groups,
  openGroups,
  onToggleGroup,
  onOpenDetail,
  onSetFlag,
  onPurge,
  onIncludeAgain,
  onGroupConfirm,
  onRetry,
  onResetFilters,
  onLoadMore,
}: PostingsListProps) {
  const renderItems = (jobs: JobRow[]) =>
    viewOpts.layout === 'cards' ? (
      <div
        className={`grid gap-md ${
          viewOpts.columns === 1
            ? 'grid-cols-1'
            : viewOpts.columns === 2
              ? 'grid-cols-1 sm:grid-cols-2'
              : viewOpts.columns === 3
                ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                : viewOpts.columns === 4
                  ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
                  : viewOpts.columns === 5
                    ? 'grid-cols-1 sm:grid-cols-3 lg:grid-cols-5'
                    : viewOpts.columns === 6
                      ? 'grid-cols-1 sm:grid-cols-3 lg:grid-cols-6'
                      : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-3'
        }`}
      >
        <AnimatedRows>
          {jobs.map((job) => (
            <AnimatedItem key={job.key} className="flex h-full flex-col">
              <PostingCard
                job={job}
                viewOpts={viewOpts}
                now={now}
                rules={rules}
                userState={userState}
                isGlobe={isGlobe}
                highlightTermsList={highlightTermsList}
                onOpenDetail={onOpenDetail}
                onSetFlag={onSetFlag}
                onPurge={onPurge}
                onIncludeAgain={onIncludeAgain}
              />
            </AnimatedItem>
          ))}
        </AnimatedRows>
      </div>
    ) : (
      <div className="flex flex-col divide-y rounded-xl border border-border bg-surface">
        <AnimatedRows>
          {jobs.map((job) => (
            <AnimatedItem key={job.key}>
              <PostingRow
                job={job}
                viewOpts={viewOpts}
                now={now}
                rules={rules}
                userState={userState}
                isGlobe={isGlobe}
                highlightTermsList={highlightTermsList}
                onOpenDetail={onOpenDetail}
                onSetFlag={onSetFlag}
                onPurge={onPurge}
                onIncludeAgain={onIncludeAgain}
              />
            </AnimatedItem>
          ))}
        </AnimatedRows>
      </div>
    );

  return (
    <div className="flex flex-col gap-md">
      {/* Group Actions Bar */}
      {!listError && (
        <>
          {currentSegment === 'review' && hasActiveFilters && filteredJobs.length > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface/50 px-md py-sm">
              <span className="text-caption text-muted-foreground">
                <NumberRoll value={filteredJobs.length} />
                {copy.topbar.results_separator}
                <NumberRoll value={allJobsCount} />
              </span>
              <button
                type="button"
                onClick={() => {
                  const keys = filteredJobs.map((j) => j.key);
                  if (keys.length > 1) {
                    onGroupConfirm({ action: 'archive', keys });
                  } else {
                    void onSetFlag(
                      keys,
                      'archived',
                      true,
                      copy.actions.toast_archived(keys.length),
                      copy.actions.toast_restored(keys.length),
                    );
                  }
                }}
                className="cursor-pointer rounded-full border border-border px-md py-2xs text-caption font-medium text-foreground hover:bg-muted"
              >
                {copy.actions.group_archive(filteredJobs.length)}
              </button>
            </div>
          )}
          {currentSegment === 'archive' && filteredJobs.length > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface/50 px-md py-sm">
              <span className="text-caption text-muted-foreground">
                <NumberRoll value={filteredJobs.length} /> archiviate
              </span>
              <button
                type="button"
                onClick={() => {
                  const keys = filteredJobs.map((j) => j.key);
                  if (keys.length > 1) {
                    onGroupConfirm({ action: 'restore', keys });
                  } else {
                    void onSetFlag(
                      keys,
                      'archived',
                      false,
                      copy.actions.toast_restored(keys.length),
                      copy.actions.toast_archived(keys.length),
                    );
                  }
                }}
                className="cursor-pointer rounded-full border border-border px-md py-2xs text-caption font-medium text-foreground hover:bg-muted"
              >
                {copy.actions.group_restore(filteredJobs.length)}
              </button>
            </div>
          )}
          {currentSegment === 'trash' && filteredJobs.length > 0 && (
            <div className="flex items-center justify-between rounded-lg border border-border bg-surface/50 px-md py-sm">
              <span className="text-caption text-muted-foreground">
                <NumberRoll value={filteredJobs.length} /> nel cestino
              </span>
              <button
                type="button"
                onClick={() => {
                  const keys = filteredJobs.map((j) => j.key);
                  onPurge(keys);
                }}
                className="cursor-pointer rounded-full border border-danger/40 px-md py-2xs text-caption font-medium text-danger hover:bg-danger/10"
              >
                {copy.actions.group_delete_permanently(filteredJobs.length)}
              </button>
            </div>
          )}
        </>
      )}

      {/* Postings List / Cards / Empty State / Error State */}
      {listError ? (
        <div className="flex flex-col items-center justify-center gap-md rounded-xl border border-danger/30 bg-surface p-xl text-center">
          <h2 className="text-title font-semibold text-foreground">{copy.error.title}</h2>
          <p className="text-label text-muted-foreground">{copy.error.description}</p>
          <button
            type="button"
            onClick={onRetry}
            className="min-h-touch cursor-pointer rounded-full border border-border px-lg text-label hover:bg-muted"
          >
            {copy.error.retry}
          </button>
        </div>
      ) : !loaded ? (
        <LoadingSkeleton variant="centered" label={copy.widget.loading} />
      ) : pagedJobs.length === 0 ? (
        <EmptyState
          title={hasActiveFilters ? copy.empty.filtered_title : emptyTitleBySegment[currentSegment]}
          description={hasActiveFilters ? copy.empty.filtered_description : emptyDescBySegment[currentSegment]}
          action={
            hasActiveFilters
              ? {
                  label: copy.empty.filtered_reset,
                  onAction: onResetFilters,
                }
              : undefined
          }
        />
      ) : groups ? (
        <div className="flex flex-col gap-lg">
          {groups.map((group) => (
            <GroupSection
              key={group.id}
              group={group}
              open={openGroups.has(group.id)}
              onToggle={onToggleGroup}
              onArchive={() =>
                onSetFlag(
                  group.jobs.map((job) => job.key),
                  'archived',
                  true,
                  copy.actions.toast_archived(group.jobs.length),
                  copy.actions.toast_restored(group.jobs.length),
                )
              }
            >
              {renderItems(group.jobs)}
            </GroupSection>
          ))}
        </div>
      ) : (
        renderItems(pagedJobs)
      )}

      {/* Show more button */}
      {sortedJobsCount > pageLimit && (
        <div className="mt-md flex justify-center">
          <ActionButton size="md" variant="outline" label={copy.view_options.show_more} onClick={onLoadMore} />
        </div>
      )}
    </div>
  );
}

const hints: Partial<Record<PostingGroupId, string>> = {
  alta: copy.groups.hint_alta,
  media: copy.groups.hint_media,
  bassa: copy.groups.hint_bassa,
  fuori: copy.groups.hint_fuori,
};
const collapsible: ReadonlySet<PostingGroupId> = new Set(['fuori']);

function GroupSection({
  group,
  open,
  onToggle,
  onArchive,
  children,
}: {
  group: PostingGroup;
  open: boolean;
  onToggle: (id: PostingGroupId) => void;
  onArchive: () => Promise<void>;
  children: React.ReactNode;
}) {
  const headingId = React.useId();
  const closable = collapsible.has(group.id);
  const hint = hints[group.id];
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-md">
      <div className={`flex items-baseline justify-between gap-md ${closable ? 'border-t border-border pt-md' : ''}`}>
        <h3
          id={headingId}
          className={`text-title font-semibold ${closable ? 'text-muted-foreground' : 'text-foreground'}`}
        >
          {copy.groups[group.id]}{' '}
          <span className="text-label font-normal text-muted-foreground">
            <NumberRoll value={group.jobs.length} />
          </span>
        </h3>
        <div className="flex items-center gap-sm">
          {hint && <span className="text-caption text-muted-foreground">{hint}</span>}
          {closable && (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => onToggle(group.id)}
              className="min-h-touch cursor-pointer rounded-full border border-border px-md text-label hover:bg-muted"
            >
              {open ? copy.groups.hide : copy.groups.show}
            </button>
          )}
          {group.id === 'fuori' && group.jobs.length > 0 && (
            <HoldButton {...copy.hold.archiveGroup} outline onConfirm={onArchive} />
          )}
        </div>
      </div>
      {(!closable || open) && children}
    </section>
  );
}
