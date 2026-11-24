import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Eye as EyeIcon, Globe as GlobeIcon, SlidersHorizontal as SlidersHorizontalIcon } from '@phosphor-icons/react';
import { ActionButton } from '../../apps/web/src/components/ui/action-button.tsx';
import { ButtonGroup } from '../../apps/web/src/components/ui/button-group.tsx';
import { SplitButton } from '../../apps/web/src/components/ui/split-button.tsx';
import { NumberRoll } from '../../apps/web/src/components/ui/number-roll.tsx';
import { PillSelect } from '../../apps/web/src/components/ui/pill-select.tsx';
import { Popover } from '../../apps/web/src/components/ui/popover.tsx';
import { SearchInput } from '../../apps/web/src/components/ui/search-input.tsx';
import { Select } from '../../apps/web/src/components/ui/select.tsx';
import { Switch } from '../../apps/web/src/components/ui/switch.tsx';
import { Tooltip } from '../../apps/web/src/components/ui/tooltip.tsx';
import { copy } from './copy.ts';
import { formatRelativeDate, type FilterCounts, type FirstSeenPreset } from './filters.ts';
import type { LavoroState } from './server.ts';
import { columnOptions, parseColumns, sortOptions, type AnnunciSegment, type ViewOptions } from './ui-common.tsx';
import { FiltersPopover } from './ui-filters.tsx';

type CollectionInfo = NonNullable<Extract<LavoroState, { status: 'ready' }>['last']>;

export type TopBarProps = {
  currentSegment: AnnunciSegment;
  isGlobe: boolean;
  segmentCounts: Record<string, number>;
  loading: boolean;
  lavoroState: LavoroState | null;
  lastRaccolta: CollectionInfo | null;
  lastProva: CollectionInfo | null;
  now: number;
  onSelectSegment: (segment: AnnunciSegment) => void;
  onRaccogli: () => Promise<void>;
  onPareriMancanti: () => Promise<void>;
  /** Review postings with no verdict or an outdated one: what Pareri mancanti would judge. */
  pareriMissing: number;
  onAnnulla: () => Promise<void>;
  onShowProvaModal: () => void;
  searchQuery: string;
  onSearchChange: (q: string | undefined) => void;
  onToggleGlobe: () => void;
  showAdvSearch: boolean;
  advancedSearchActive: boolean;
  onToggleAdvSearch: () => void;
  // Filters popover props
  activeFiltersCount: number;
  firstSeenPreset: FirstSeenPreset;
  minScoreParam?: number;
  filterCounts: FilterCounts;
  workModesParam: string[];
  sourcesParam: string[];
  categoriesParam: string[];
  onUpdateFilters: (params: Record<string, string | undefined>) => void;
  // Sort & view props
  sortedCount: number;
  allCount: number;
  hasActiveFilters: boolean;
  sortOption: string;
  onSortChange: (sort: string | undefined) => void;
  viewOpts: ViewOptions;
  onUpdateView: (opts: ViewOptions) => void;
  onOpenImport?: () => void;
};

export function TopBar({
  currentSegment,
  isGlobe,
  segmentCounts,
  loading,
  lavoroState,
  lastRaccolta,
  lastProva,
  now,
  onSelectSegment,
  onRaccogli,
  onPareriMancanti,
  pareriMissing,
  onAnnulla,
  onShowProvaModal,
  searchQuery,
  onSearchChange,
  onToggleGlobe,
  showAdvSearch,
  advancedSearchActive,
  onToggleAdvSearch,
  activeFiltersCount,
  firstSeenPreset,
  minScoreParam,
  filterCounts,
  workModesParam,
  sourcesParam,
  categoriesParam,
  onUpdateFilters,
  sortedCount,
  allCount,
  hasActiveFilters,
  sortOption,
  onSortChange,
  viewOpts,
  onUpdateView,
  onOpenImport,
}: TopBarProps) {
  const isCollecting = Boolean(lavoroState?.status === 'ready' && lavoroState.collection);
  const pareri = lavoroState?.status === 'ready' ? lavoroState.pareri : undefined;
  function run(action: () => Promise<void>) {
    setActionFailed(false);
    action().catch(() => setActionFailed(true));
  }
  const [actionFailed, setActionFailed] = React.useState(false);

  return (
    <div className="flex flex-col gap-md">
      {/* Top Segmented Filter & Collection Controls */}
      <div className="flex flex-wrap items-center justify-between gap-md">
        <ButtonGroup
          size="sm"
          variant="outline"
          items={(
            [
              { id: 'review', label: copy.segments.review },
              { id: 'archive', label: copy.segments.archive },
              { id: 'blacklisted', label: copy.segments.blacklisted },
              { id: 'trash', label: copy.segments.trash },
            ] as const
          ).map((seg) => ({
            id: seg.id,
            label: seg.label,
            active: !isGlobe && currentSegment === seg.id,
            onClick: () => onSelectSegment(seg.id),
            content: (
              <span className="flex items-center gap-xs">
                <span>{seg.label}</span>
                {!loading && (
                  <span className="rounded-full bg-muted/60 px-xs text-caption tabular-nums">
                    <NumberRoll value={segmentCounts[seg.id] ?? 0} />
                  </span>
                )}
              </span>
            ),
          }))}
        />

        {/* Collection Controls */}
        <div className="flex items-center gap-xs">
          {actionFailed ? (
            <span role="alert" className="text-caption text-danger">
              {copy.actions.toast_error}
            </span>
          ) : (
            pareri && (
              <output className="text-caption text-muted-foreground">
                {pareri.running
                  ? copy.pareri.running(pareri.done, pareri.done + pareri.remaining)
                  : pareri.reason
                    ? copy.pareri.stopped(pareri.done, pareri.done + pareri.remaining, pareri.reason)
                    : copy.pareri.finished(pareri.done)}
              </output>
            )
          )}
          <div className="hidden items-center gap-xs text-caption text-muted-foreground lg:flex">
            {lastRaccolta && (
              <span>
                {copy.collection.last_run(
                  formatRelativeDate(lastRaccolta.finishedAt, now),
                  lastRaccolta.newCount,
                  lastRaccolta.excludedCount,
                )}
              </span>
            )}
            {lastProva && (!lastRaccolta || lastProva.finishedAt > lastRaccolta.finishedAt) && (
              <span>
                {lastRaccolta && ' • '}
                {copy.collection.last_prova(lastProva.newCount)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Collection Progress Banner */}
      <AnimatePresence>
        {isCollecting && lavoroState?.status === 'ready' && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -4 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -4 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between gap-md rounded-xl border border-border/80 bg-surface/70 px-md py-sm shadow-xs">
              <div className="flex min-w-0 items-center gap-md">
                <span aria-hidden="true" className="inline-flex size-xs shrink-0 rounded-full bg-primary" />
                <div className="flex min-w-0 flex-wrap items-center gap-xs">
                  <span className="shrink-0 text-label font-medium text-foreground">{copy.collection.running}</span>
                  {lavoroState.collection && (
                    <>
                      <span className="text-muted-foreground/40">•</span>
                      <span className="truncate text-caption text-muted-foreground">
                        {lavoroState.collection.site && `${lavoroState.collection.site} `}
                        (ricerca {lavoroState.collection.searchesDone + 1}/{lavoroState.collection.searchesTotal})
                        {lavoroState.collection.newCount > 0
                          ? `: ${lavoroState.collection.newCount} nuove offerte`
                          : ''}
                      </span>
                    </>
                  )}
                </div>
                {lavoroState.collection && lavoroState.collection.searchesTotal > 0 && (
                  <div className="hidden h-2xs w-4xl shrink-0 overflow-hidden rounded-full bg-muted sm:block">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(
                            5,
                            ((lavoroState.collection.searchesDone + 1) / lavoroState.collection.searchesTotal) * 100,
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                )}
              </div>
              <ActionButton size="sm" variant="destructive" label={copy.topbar.annulla} action={onAnnulla} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Bar: Search, Filters, View Options, Sort, Refresh */}
      <div className="flex flex-wrap items-center justify-between gap-md py-xs">
        <div className="flex min-w-popover-sm flex-1 items-center gap-xs">
          <SearchInput
            className="flex-1"
            aria-label={copy.search.label}
            placeholder={copy.search.placeholder}
            clearLabel={copy.search.clear}
            shortcut="/"
            value={searchQuery}
            onValueChange={onSearchChange}
          />

          <Tooltip content={copy.search.globe}>
            <button
              type="button"
              aria-label={copy.search.globe}
              aria-pressed={isGlobe}
              onClick={onToggleGlobe}
              className={`flex h-touch w-touch shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors ${
                isGlobe
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <GlobeIcon className="size-icon" />
            </button>
          </Tooltip>

          <Tooltip content={copy.search.advanced}>
            <button
              type="button"
              aria-label={copy.search.advanced}
              aria-pressed={showAdvSearch}
              onClick={onToggleAdvSearch}
              className={`flex h-touch w-touch shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors ${
                advancedSearchActive
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              <SlidersHorizontalIcon className="size-icon" />
            </button>
          </Tooltip>

          <FiltersPopover
            activeFiltersCount={activeFiltersCount}
            firstSeenPreset={firstSeenPreset}
            minScoreParam={minScoreParam}
            filterCounts={filterCounts}
            workModesParam={workModesParam}
            sourcesParam={sourcesParam}
            categoriesParam={categoriesParam}
            onUpdate={onUpdateFilters}
          />
        </div>

        <div className="flex items-center gap-sm">
          {hasActiveFilters && (
            <span className="text-label text-muted-foreground">
              <NumberRoll value={sortedCount} />
              {copy.topbar.results_separator}
              <NumberRoll value={allCount} />
            </span>
          )}

          <PillSelect
            size="md"
            align="end"
            label={copy.topbar.sort}
            options={sortOptions}
            value={sortOption}
            onValueChange={onSortChange}
          />

          <Tooltip content={copy.topbar.view_options}>
            <Popover
              size="md"
              align="end"
              label={copy.view_options.title}
              trigger={
                <button
                  type="button"
                  aria-label={copy.topbar.view_options}
                  className="flex h-touch w-touch cursor-pointer items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <EyeIcon className="size-icon" />
                </button>
              }
            >
              <div className="flex flex-col gap-md">
                <h3 className="text-label">{copy.view_options.title}</h3>

                <div className="flex flex-col gap-xs">
                  <span className="text-caption text-muted-foreground">{copy.view_options.layout}</span>
                  <ButtonGroup
                    size="sm"
                    variant="outline"
                    label={copy.view_options.layout}
                    items={[
                      {
                        id: 'cards',
                        label: copy.view_options.cards,
                        active: viewOpts.layout === 'cards',
                        onClick: () => onUpdateView({ ...viewOpts, layout: 'cards' }),
                      },
                      {
                        id: 'rows',
                        label: copy.view_options.rows,
                        active: viewOpts.layout === 'rows',
                        onClick: () => onUpdateView({ ...viewOpts, layout: 'rows' }),
                      },
                    ]}
                  />
                </div>

                {viewOpts.layout === 'cards' && (
                  <div className="flex flex-col gap-xs">
                    <span className="text-caption text-muted-foreground">{copy.view_options.columns}</span>
                    <Select
                      hideLabel
                      label={copy.view_options.columns}
                      options={columnOptions}
                      value={String(viewOpts.columns)}
                      onValueChange={(v) => onUpdateView({ ...viewOpts, columns: parseColumns(v) })}
                    />
                  </div>
                )}

                <div className="flex flex-col gap-xs">
                  <span className="text-caption text-muted-foreground">{copy.view_options.visibility}</span>
                  {(
                    [
                      ['showDescription', copy.view_options.show_description],
                      ['showCategories', copy.view_options.show_categories],
                      ['showScore', copy.view_options.show_score],
                      ['showDate', copy.view_options.show_date],
                      ['showMode', copy.view_options.show_mode],
                    ] as const
                  ).map(([key, label]) => (
                    <Switch
                      key={key}
                      size="sm"
                      className="w-full"
                      label={label}
                      labelPosition="start"
                      checked={viewOpts[key]}
                      onCheckedChange={(on) => onUpdateView({ ...viewOpts, [key]: on })}
                    />
                  ))}
                </div>
              </div>
            </Popover>
          </Tooltip>

          <SplitButton
            variant="secondary"
            label={copy.topbar.raccogli}
            loading={isCollecting}
            menuLabel={copy.topbar.altre_azioni}
            onClick={() => run(onRaccogli)}
            menuItems={[
              ...(pareri?.running
                ? [
                    {
                      id: 'pareri',
                      label: copy.pareri.running(pareri.done, pareri.done + pareri.remaining),
                      disabled: true,
                      onSelect: () => {},
                    },
                  ]
                : pareriMissing > 0
                  ? [{ id: 'pareri', label: copy.pareri.missing(pareriMissing), onSelect: () => run(onPareriMancanti) }]
                  : []),
              ...(lavoroState?.status === 'ready' && lavoroState.dryRun
                ? [{ id: 'prova', label: copy.topbar.view_prova, onSelect: onShowProvaModal }]
                : []),
              ...(onOpenImport ? [{ id: 'import', label: copy.import.button, onSelect: onOpenImport }] : []),
            ]}
          />
        </div>
      </div>
    </div>
  );
}
