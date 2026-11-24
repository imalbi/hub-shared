import { NumberRoll } from '../../apps/web/src/components/ui/number-roll.tsx';
import * as React from 'react';
import { FunnelIcon } from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { PillSelect } from '../../apps/web/src/components/ui/pill-select.tsx';
import { Popover } from '../../apps/web/src/components/ui/popover.tsx';
import { Select } from '../../apps/web/src/components/ui/select.tsx';
import { Slider } from '../../apps/web/src/components/ui/slider.tsx';
import { Chip } from '../../apps/web/src/components/chip.tsx';
import { copy } from './copy.ts';
import type { FilterCounts, FirstSeenPreset } from './filters.ts';
import type { AdvancedSearchMode } from './search.ts';
import { Checkbox } from './ui-checkbox.tsx';
import { advancedModeOptions, firstSeenOptions, isValidWorkMode, workModeLabel } from './ui-common.tsx';

export function AdvancedSearchBar({
  show,
  advWholeWords,
  advMode,
  advTitle,
  advCompany,
  advDesc,
  advLoc,
  onUpdate,
}: {
  show: boolean;
  advWholeWords: boolean;
  advMode: AdvancedSearchMode;
  advTitle: string;
  advCompany: string;
  advDesc: string;
  advLoc: string;
  onUpdate: (params: Record<string, string | undefined>) => void;
}) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
          animate={{
            opacity: 1,
            height: 'auto',
            transition: { duration: 0.22, ease: [0.16, 1, 0.3, 1] },
          }}
          exit={{
            opacity: 0,
            height: 0,
            overflow: 'hidden',
            transition: { duration: 0.16, ease: [0.16, 1, 0.3, 1] },
          }}
        >
          <div className="flex flex-col gap-sm rounded-xl border border-border/30 bg-surface/40 p-md">
            <div className="flex flex-wrap items-center justify-between gap-sm">
              <span className="text-label font-medium">{copy.search.advanced}</span>
              <div className="flex items-center gap-md">
                <Checkbox
                  checked={advWholeWords}
                  onCheckedChange={(checked) => onUpdate({ adv_whole: checked ? '1' : undefined })}
                  label={copy.search.whole_words_only}
                />
                <PillSelect
                  size="sm"
                  align="end"
                  label={copy.search.mode}
                  options={advancedModeOptions}
                  value={advMode}
                  onValueChange={(v) => onUpdate({ adv_mode: v === 'all_words' ? undefined : v })}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-sm sm:grid-cols-2 lg:grid-cols-4">
              <input
                type="text"
                placeholder={copy.search.field_title}
                value={advTitle}
                onChange={(e) => onUpdate({ adv_title: e.target.value || undefined })}
                className="h-touch rounded-lg border border-border/40 bg-surface/70 px-sm text-label transition-colors placeholder:text-muted-foreground/50 focus:border-primary/50 focus:bg-surface focus:outline-none"
              />
              <input
                type="text"
                placeholder={copy.search.field_company}
                value={advCompany}
                onChange={(e) => onUpdate({ adv_company: e.target.value || undefined })}
                className="h-touch rounded-lg border border-border/40 bg-surface/70 px-sm text-label transition-colors placeholder:text-muted-foreground/50 focus:border-primary/50 focus:bg-surface focus:outline-none"
              />
              <input
                type="text"
                placeholder={copy.search.field_description}
                value={advDesc}
                onChange={(e) => onUpdate({ adv_desc: e.target.value || undefined })}
                className="h-touch rounded-lg border border-border/40 bg-surface/70 px-sm text-label transition-colors placeholder:text-muted-foreground/50 focus:border-primary/50 focus:bg-surface focus:outline-none"
              />
              <input
                type="text"
                placeholder={copy.search.field_location}
                value={advLoc}
                onChange={(e) => onUpdate({ adv_loc: e.target.value || undefined })}
                className="h-touch rounded-lg border border-border/40 bg-surface/70 px-sm text-label transition-colors placeholder:text-muted-foreground/50 focus:border-primary/50 focus:bg-surface focus:outline-none"
              />
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export type FiltersPopoverProps = {
  activeFiltersCount: number;
  firstSeenPreset: FirstSeenPreset;
  minScoreParam?: number;
  filterCounts: FilterCounts;
  workModesParam: string[];
  sourcesParam: string[];
  categoriesParam: string[];
  onUpdate: (params: Record<string, string | undefined>) => void;
};

export function FiltersPopover({
  activeFiltersCount,
  firstSeenPreset,
  minScoreParam,
  filterCounts,
  workModesParam,
  sourcesParam,
  categoriesParam,
  onUpdate,
}: FiltersPopoverProps) {
  return (
    <Popover
      size="lg"
      align="end"
      label={copy.filters.title}
      trigger={
        <button
          type="button"
          className={`flex h-touch cursor-pointer items-center gap-xs rounded-full border px-md text-label transition-colors ${
            activeFiltersCount > 0
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          <FunnelIcon className="size-icon-sm" />
          <span>{copy.topbar.filters}</span>
          {activeFiltersCount > 0 && (
            <span className="rounded-full bg-primary px-xs text-caption text-primary-foreground">
              <NumberRoll value={activeFiltersCount} />
            </span>
          )}
        </button>
      }
    >
      <div className="flex flex-col gap-md">
        <div className="flex items-center justify-between">
          <h3 className="text-label">{copy.filters.title}</h3>
          <button
            type="button"
            onClick={() => {
              onUpdate({
                fs: undefined,
                score: undefined,
                modes: undefined,
                sources: undefined,
                cats: undefined,
                locs: undefined,
                companies: undefined,
              });
            }}
            className="cursor-pointer text-caption text-primary hover:underline"
          >
            {copy.filters.reset}
          </button>
        </div>

        <div className="flex flex-col gap-xs">
          <span className="text-caption text-muted-foreground">{copy.filters.first_seen}</span>
          <Select
            hideLabel
            label={copy.filters.first_seen}
            options={firstSeenOptions}
            value={firstSeenPreset}
            onValueChange={(v) => onUpdate({ fs: v === 'always' ? undefined : v })}
          />
        </div>

        <div className="flex flex-col gap-xs">
          <div className="flex items-center justify-between text-caption text-muted-foreground">
            <span>{copy.filters.min_score}</span>
            <span className="tabular-nums">{minScoreParam ?? 0}</span>
          </div>
          <Slider
            label={copy.filters.min_score}
            min={0}
            max={20}
            step={1}
            value={minScoreParam ?? 0}
            format={(v) => `≥ ${v}`}
            onValueChange={([v]) => onUpdate({ score: v === 0 ? undefined : String(v) })}
          />
        </div>

        <div className="flex flex-col gap-xs">
          <span className="text-caption text-muted-foreground">{copy.filters.work_mode}</span>
          <div className="flex flex-wrap gap-xs">
            {(['remote', 'hybrid', 'onsite'] as const).map((m) => {
              const active = workModesParam.includes(m);
              const count = filterCounts.workModes[m] ?? 0;
              return (
                <button
                  key={m}
                  type="button"
                  aria-label={`${workModeLabel(m)} (${count})`}
                  aria-pressed={active}
                  onClick={() => {
                    const next = active ? workModesParam.filter((x) => x !== m) : [...workModesParam, m];
                    onUpdate({ modes: next.length ? next.join(',') : undefined });
                  }}
                  className={`cursor-pointer rounded-full border px-sm py-2xs text-caption ${
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {workModeLabel(m)} (<NumberRoll value={count} />)
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-xs">
          <span className="text-caption text-muted-foreground">{copy.filters.sources}</span>
          <div className="flex flex-wrap gap-xs">
            {Object.keys(filterCounts.sources).map((src) => {
              const active = sourcesParam.includes(src);
              const count = filterCounts.sources[src] ?? 0;
              return (
                <button
                  key={src}
                  type="button"
                  aria-label={`${src} (${count})`}
                  aria-pressed={active}
                  onClick={() => {
                    const next = active ? sourcesParam.filter((x) => x !== src) : [...sourcesParam, src];
                    onUpdate({ sources: next.length ? next.join(',') : undefined });
                  }}
                  className={`cursor-pointer rounded-full border px-sm py-2xs text-caption ${
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {src} (<NumberRoll value={count} />)
                </button>
              );
            })}
          </div>
        </div>

        {Object.keys(filterCounts.categories).length > 0 && (
          <div className="flex flex-col gap-xs">
            <span className="text-caption text-muted-foreground">{copy.filters.categories}</span>
            <div className="flex flex-wrap gap-xs">
              {Object.entries(filterCounts.categories)
                .filter(([, count]) => count > 0)
                .map(([cat, count]) => {
                  const active = categoriesParam.includes(cat);
                  return (
                    <button
                      key={cat}
                      type="button"
                      aria-label={`${cat} (${count})`}
                      aria-pressed={active}
                      onClick={() => {
                        const next = active ? categoriesParam.filter((c) => c !== cat) : [...categoriesParam, cat];
                        onUpdate({ cats: next.length ? next.join(',') : undefined });
                      }}
                      className={`cursor-pointer rounded-full border px-sm py-2xs text-caption ${
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      {cat} (<NumberRoll value={count} />)
                    </button>
                  );
                })}
            </div>
          </div>
        )}
      </div>
    </Popover>
  );
}

export function FilterChips({
  hasActiveFilters,
  searchQuery,
  firstSeenPreset,
  minScoreParam,
  workModesParam,
  sourcesParam,
  categoriesParam,
  locationsParam,
  companiesParam,
  ruleParam,
  rules,
  onUpdate,
}: {
  hasActiveFilters: boolean;
  searchQuery: string;
  firstSeenPreset: FirstSeenPreset;
  minScoreParam?: number;
  workModesParam: string[];
  sourcesParam: string[];
  categoriesParam: string[];
  locationsParam: string[];
  companiesParam: string[];
  ruleParam?: number;
  rules?: Array<{ id: number; value: string }>;
  onUpdate: (patch: Record<string, string | undefined>) => void;
}) {
  if (!hasActiveFilters) return null;

  const rule = ruleParam !== undefined ? rules?.find((r) => r.id === ruleParam) : undefined;

  return (
    <div className="flex flex-wrap items-center gap-xs">
      {ruleParam !== undefined && (
        <Chip
          label={`Regola #${ruleParam}${rule ? `: "${rule.value}"` : ''}`}
          onRemove={() => onUpdate({ rule: undefined })}
        />
      )}
      {searchQuery && <Chip label={copy.search.chip_query(searchQuery)} onRemove={() => onUpdate({ q: undefined })} />}
      {firstSeenPreset !== 'always' && (
        <Chip
          label={`${copy.filters.first_seen}: ${firstSeenOptions.find((o) => o.value === firstSeenPreset)?.label ?? firstSeenPreset}`}
          onRemove={() => onUpdate({ fs: undefined })}
        />
      )}
      {minScoreParam !== undefined && (
        <Chip label={`${copy.filters.min_score}: ≥${minScoreParam}`} onRemove={() => onUpdate({ score: undefined })} />
      )}
      {workModesParam.map((m) => (
        <Chip
          key={m}
          label={isValidWorkMode(m) ? workModeLabel(m) : m}
          onRemove={() => {
            const next = workModesParam.filter((x) => x !== m);
            onUpdate({ modes: next.length ? next.join(',') : undefined });
          }}
        />
      ))}
      {sourcesParam.map((src) => (
        <Chip
          key={src}
          label={src}
          onRemove={() => {
            const next = sourcesParam.filter((x) => x !== src);
            onUpdate({ sources: next.length ? next.join(',') : undefined });
          }}
        />
      ))}
      {categoriesParam.map((cat) => (
        <Chip
          key={cat}
          label={cat}
          onRemove={() => {
            const next = categoriesParam.filter((x) => x !== cat);
            onUpdate({ cats: next.length ? next.join(',') : undefined });
          }}
        />
      ))}
      {locationsParam.map((loc) => (
        <Chip
          key={loc}
          label={loc}
          onRemove={() => {
            const next = locationsParam.filter((x) => x !== loc);
            onUpdate({ locs: next.length ? next.join(',') : undefined });
          }}
        />
      ))}
      {companiesParam.map((comp) => (
        <Chip
          key={comp}
          label={comp}
          onRemove={() => {
            const next = companiesParam.filter((x) => x !== comp);
            onUpdate({ companies: next.length ? next.join(',') : undefined });
          }}
        />
      ))}
      <button
        type="button"
        onClick={() => {
          onUpdate({
            q: undefined,
            globe: undefined,
            adv_mode: undefined,
            adv_whole: undefined,
            adv_title: undefined,
            adv_company: undefined,
            adv_desc: undefined,
            adv_loc: undefined,
            fs: undefined,
            score: undefined,
            modes: undefined,
            sources: undefined,
            cats: undefined,
            locs: undefined,
            companies: undefined,
            rule: undefined,
          });
        }}
        className="ml-xs cursor-pointer text-caption text-primary hover:underline"
      >
        {copy.search.clear_all}
      </button>
    </div>
  );
}
