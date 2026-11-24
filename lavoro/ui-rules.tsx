import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import { TabBarRow } from '../../apps/web/src/shell/header-slot.tsx';
import { SurfaceScroller } from '../../apps/web/src/shell/page-surface.tsx';
import * as React from 'react';
import {
  ArrowSquareOutIcon,
  Check as CheckIcon,
  Eye as EyeIcon,
  MagnifyingGlass as MagnifyingGlassIcon,
  PencilSimple as PencilSimpleIcon,
  Plus as PlusIcon,
  Trash as TrashIcon,
  X as XIcon,
} from '@phosphor-icons/react';
import { HoldButton } from '../../apps/web/src/components/hold-button.tsx';
import { Badge } from '../../apps/web/src/components/ui/badge.tsx';
import { Dialog } from '../../apps/web/src/components/ui/dialog.tsx';
import { PillSelect } from '../../apps/web/src/components/ui/pill-select.tsx';
import { Switch } from '../../apps/web/src/components/ui/switch.tsx';
import {
  blacklistFields,
  blacklistMatchTypes,
  matchRule,
  type BlacklistField,
  type BlacklistRule,
} from './blacklist.ts';
import { copy } from './copy.ts';
import type { JobRow, RuleRow } from './server.ts';

function isBlacklistField(value: string): value is BlacklistField {
  return blacklistFields.some((item) => item === value);
}

function isBlacklistMatchType(value: string): value is (typeof blacklistMatchTypes)[number] {
  return blacklistMatchTypes.some((item) => item === value);
}

export type RulesPageProps = {
  rules: RuleRow[];
  jobs: JobRow[];
  onCreateRule: (input: {
    field: BlacklistField;
    matchType: (typeof blacklistMatchTypes)[number];
    value: string;
    note: string;
    enabled: boolean;
  }) => Promise<void>;
  onUpdateRule: (input: {
    id: number;
    field: BlacklistField;
    matchType: (typeof blacklistMatchTypes)[number];
    value: string;
    note: string;
    enabled: boolean;
  }) => Promise<void>;
  onDeleteRule: (id: number) => Promise<void>;
  onToggleEnabled: (id: number, enabled: boolean) => Promise<void>;
  onViewRulePostings: (ruleId: number) => void;
  onOpenDetail: (key: string) => void;
  prefilledRule?: {
    field: BlacklistField;
    matchType: (typeof blacklistMatchTypes)[number];
    value: string;
    note?: string;
  } | null;
  onClearPrefilled?: () => void;
};

export function RulesPage({
  rules,
  jobs,
  onCreateRule,
  onUpdateRule,
  onDeleteRule,
  onToggleEnabled,
  onViewRulePostings,
  onOpenDetail,
  prefilledRule,
  onClearPrefilled,
}: RulesPageProps) {
  // Form state
  const [editingRuleId, setEditingRuleId] = React.useState<number | null>(null);
  const [field, setField] = React.useState<BlacklistField>('company');
  const [matchType, setMatchType] = React.useState<(typeof blacklistMatchTypes)[number]>('contains');
  const [value, setValue] = React.useState('');
  const [note, setNote] = React.useState('');
  const [enabled, setEnabled] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  // List filter state
  const [ruleSearch, setRuleSearch] = React.useState('');
  const [ruleFilter, setRuleFilter] = React.useState<'all' | 'active' | 'disabled'>('all');
  const [deleteTarget, setDeleteTarget] = React.useState<RuleRow | null>(null);
  const surface = React.useContext(SurfaceScroller);
  const scrollTop = () => surface?.current?.scrollTo(0, 0);

  // Apply prefilled rule if received
  const [appliedPrefill, setAppliedPrefill] = React.useState(prefilledRule);
  if (prefilledRule !== appliedPrefill) {
    setAppliedPrefill(prefilledRule);
    if (prefilledRule) {
      setField(prefilledRule.field);
      setMatchType(prefilledRule.matchType);
      setValue(prefilledRule.value);
      setNote(prefilledRule.note ?? '');
      setEnabled(true);
      setEditingRuleId(null);
    }
  }
  React.useEffect(() => {
    if (prefilledRule && onClearPrefilled) onClearPrefilled();
  }, [prefilledRule, onClearPrefilled]);

  // Live match calculation for the form
  const matchedJobs = React.useMemo(() => {
    const trimmed = value.trim();
    if (!trimmed) return [];
    const testRule: BlacklistRule = {
      id: 0,
      enabled: true,
      field,
      matchType,
      value: trimmed,
    };
    return jobs.filter((j) =>
      matchRule(testRule, {
        company: j.company,
        title: j.title,
        description: j.description,
        location: j.location,
        site: j.site,
        work_mode: j.workMode,
        key: j.key,
      }),
    );
  }, [jobs, field, matchType, value]);

  // Distinct values for suggestion datalist
  const suggestions = React.useMemo(() => {
    if (field === 'company') {
      return Array.from(new Set(jobs.map((j) => j.company).filter(Boolean))).toSorted((a, b) => a.localeCompare(b));
    }
    if (field === 'site') {
      return Array.from(new Set(jobs.map((j) => j.site).filter(Boolean))).toSorted((a, b) => a.localeCompare(b));
    }
    if (field === 'location') {
      return Array.from(new Set(jobs.map((j) => j.location).filter(Boolean))).toSorted((a, b) => a.localeCompare(b));
    }
    if (field === 'work_mode') {
      return ['remote', 'hybrid', 'onsite'];
    }
    return [];
  }, [jobs, field]);

  const resetForm = () => {
    setEditingRuleId(null);
    setField('company');
    setMatchType('contains');
    setValue('');
    setNote('');
    setEnabled(true);
  };

  const handleStartEdit = (r: RuleRow) => {
    setEditingRuleId(r.id);
    setField(r.field);
    setMatchType(r.matchType);
    setValue(r.value);
    setNote(r.note ?? '');
    setEnabled(r.enabled);
    surface?.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || saving) return;
    setSaving(true);
    try {
      if (editingRuleId !== null) {
        await onUpdateRule({
          id: editingRuleId,
          field,
          matchType,
          value: value.trim(),
          note: note.trim(),
          enabled,
        });
      } else {
        await onCreateRule({
          field,
          matchType,
          value: value.trim(),
          note: note.trim(),
          enabled,
        });
      }
      resetForm();
    } finally {
      setSaving(false);
    }
  };

  // Filtered rules list
  const filteredRules = React.useMemo(() => {
    return rules.filter((r) => {
      if (ruleFilter === 'active' && !r.enabled) return false;
      if (ruleFilter === 'disabled' && r.enabled) return false;
      if (ruleSearch.trim()) {
        const q = ruleSearch.toLowerCase();
        const matchesVal = r.value.toLowerCase().includes(q);
        const matchesNote = (r.note ?? '').toLowerCase().includes(q);
        return matchesVal || matchesNote;
      }
      return true;
    });
  }, [rules, ruleFilter, ruleSearch]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-xl">
      {/* 1. Rule Creation / Editing Form */}
      <div className="shrink-0 rounded-xl border border-border bg-surface p-lg">
        <div className="mb-md flex items-center justify-between">
          <h2 className="text-title font-semibold text-foreground">
            {editingRuleId !== null ? copy.rules.edit_rule : copy.rules.new_rule}
          </h2>
          {editingRuleId !== null && (
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex cursor-pointer items-center gap-xs text-caption text-muted-foreground hover:text-foreground"
            >
              <XIcon className="size-icon-sm" />
              <span>{copy.rules.cancel}</span>
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-md">
          <div className="grid grid-cols-1 gap-md md:grid-cols-3">
            {/* Field selector */}
            <div className="flex flex-col gap-xs">
              <label className="text-caption font-medium text-foreground">{copy.rules.field}</label>
              <PillSelect
                size="md"
                block
                label={copy.rules.field}
                options={blacklistFields.map((f) => ({ value: f, label: copy.rules.fields[f] }))}
                value={field}
                onValueChange={(v) => {
                  if (isBlacklistField(v)) setField(v);
                }}
              />
            </div>

            {/* Match type selector */}
            <div className="flex flex-col gap-xs">
              <label className="text-caption font-medium text-foreground">{copy.rules.match}</label>
              <PillSelect
                size="md"
                block
                label={copy.rules.match}
                options={blacklistMatchTypes.map((m) => ({ value: m, label: copy.rules.match_types[m] }))}
                value={matchType}
                onValueChange={(v) => {
                  if (isBlacklistMatchType(v)) setMatchType(v);
                }}
              />
            </div>

            {/* Value input with suggestions */}
            <div className="flex flex-col gap-xs">
              <label htmlFor="rule-value" className="text-caption font-medium text-foreground">
                {copy.rules.value}
              </label>
              <ValueField value={value} onChange={setValue} suggestions={suggestions} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-md md:grid-cols-2">
            {/* Note input */}
            <div className="flex flex-col gap-xs">
              <label htmlFor="rule-note" className="text-caption font-medium text-foreground">
                {copy.rules.note}
              </label>
              <input
                id="rule-note"
                aria-label={copy.rules.note}
                type="text"
                placeholder={copy.rules.note_placeholder}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="h-touch rounded-lg border border-border bg-background px-sm text-label text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
              />
            </div>

            {/* Enabled switch & Submit button */}
            <div className="flex items-center justify-between gap-md pt-md md:justify-end">
              <div className="flex items-center gap-xs">
                <Switch
                  id="rule-enabled"
                  aria-label={copy.rules.enabled}
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  size="sm"
                />
                <label htmlFor="rule-enabled" className="cursor-pointer text-caption text-foreground select-none">
                  {copy.rules.enabled}
                </label>
              </div>

              <button
                type="submit"
                disabled={!value.trim() || saving}
                className="inline-flex h-touch cursor-pointer items-center justify-center gap-xs rounded-full bg-primary px-lg text-label font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-default disabled:opacity-40"
              >
                {editingRuleId !== null ? (
                  <CheckIcon className="size-icon-sm" />
                ) : (
                  <PlusIcon className="size-icon-sm" />
                )}
                <span>{copy.rules.save}</span>
              </button>
            </div>
          </div>

          {/* Live match preview (spec requirement) */}
          {value.trim().length > 0 && (
            <div className="mt-sm flex flex-col gap-xs rounded-lg border border-border bg-background/50 p-sm">
              <div className="flex items-center justify-between text-caption font-medium">
                <span className="text-foreground">{copy.rules.live_matches}</span>
                <span className="text-muted-foreground">{copy.rules.matches_count(matchedJobs.length)}</span>
              </div>
              {matchedJobs.length > 0 ? (
                <div className="flex flex-wrap gap-xs pt-xs">
                  {matchedJobs.slice(0, 6).map((j) => (
                    <button
                      key={j.key}
                      type="button"
                      onClick={() => onOpenDetail(j.key)}
                      className="group inline-flex cursor-pointer items-center gap-xs rounded-xl border border-border bg-surface px-sm py-2xs text-caption text-foreground transition-colors hover:border-primary hover:text-primary"
                    >
                      <span className="font-medium wrap-anywhere">{j.title}</span>
                      <span className="text-muted-foreground">({j.company})</span>
                      <ArrowSquareOutIcon className="size-icon-xs text-muted-foreground group-hover:text-primary" />
                    </button>
                  ))}
                </div>
              ) : (
                <EmptyState scene="search" title={copy.rules.no_matches} />
              )}
            </div>
          )}
        </form>
      </div>

      {/* 2. Rules List & Filters */}
      <div className="flex min-h-0 flex-1 flex-col gap-md">
        <TabBarRow>
          <div className="flex flex-wrap items-center justify-between gap-md">
            {/* Search rules */}
            <div className="relative min-w-[16rem]">
              <MagnifyingGlassIcon className="absolute top-1/2 left-sm size-icon-sm -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder={copy.rules.search_placeholder}
                aria-label={copy.rules.search_placeholder}
                value={ruleSearch}
                onChange={(e) => {
                  scrollTop();
                  setRuleSearch(e.target.value);
                }}
                className="h-touch w-full rounded-full border border-border bg-surface pr-sm pl-xl text-label text-foreground placeholder:text-muted-foreground focus:ring-1 focus:ring-primary focus:outline-none"
              />
            </div>

            {/* Attive / Disattivate / Tutte segments */}
            <div className="inline-flex rounded-full border border-border bg-surface p-3xs">
              <button
                type="button"
                onClick={() => {
                  scrollTop();
                  setRuleFilter('all');
                }}
                className={`cursor-pointer rounded-full px-md py-2xs text-caption font-medium transition-colors ${
                  ruleFilter === 'all'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {copy.rules.filter_all}
              </button>
              <button
                type="button"
                onClick={() => {
                  scrollTop();
                  setRuleFilter('active');
                }}
                className={`cursor-pointer rounded-full px-md py-2xs text-caption font-medium transition-colors ${
                  ruleFilter === 'active'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {copy.rules.filter_active}
              </button>
              <button
                type="button"
                onClick={() => {
                  scrollTop();
                  setRuleFilter('disabled');
                }}
                className={`cursor-pointer rounded-full px-md py-2xs text-caption font-medium transition-colors ${
                  ruleFilter === 'disabled'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {copy.rules.filter_disabled}
              </button>
            </div>
          </div>
        </TabBarRow>
        {/* Rules Table / Cards */}
        <div key={ruleFilter} className="pb-xl">
          {filteredRules.length > 0 ? (
            <div className="flex flex-col divide-y divide-border rounded-xl border border-border bg-surface">
              {filteredRules.map((rule) => {
                // Calculate matching count for this rule
                const ruleMatchesCount = jobs.filter((j) =>
                  matchRule(rule, {
                    company: j.company,
                    title: j.title,
                    description: j.description,
                    location: j.location,
                    site: j.site,
                    work_mode: j.workMode,
                    key: j.key,
                  }),
                ).length;

                return (
                  <div
                    key={rule.id}
                    className="flex flex-wrap items-center justify-between gap-md p-md transition-colors hover:bg-muted/30"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-md">
                      <Switch
                        aria-label={`${rule.enabled ? 'Disattiva' : 'Attiva'} regola ${rule.value}`}
                        checked={rule.enabled}
                        onCheckedChange={(c) => void onToggleEnabled(rule.id, c)}
                        size="sm"
                        className="mt-3xs"
                      />

                      <div className="flex min-w-0 flex-1 flex-col">
                        <div className="flex flex-wrap items-center gap-xs">
                          <Badge size="sm" tone="primary" outline>
                            {copy.rules.fields[rule.field]}
                          </Badge>
                          <Badge size="sm" tone="neutral">
                            {copy.rules.match_types[rule.matchType]}
                          </Badge>
                          <span className="min-w-0 flex-1 text-body wrap-anywhere text-foreground">{rule.value}</span>
                        </div>
                        <span className="mt-3xs text-caption wrap-anywhere text-muted-foreground">
                          {rule.note ? `${rule.note} · ` : ''}
                          {copy.rules.matches_count(ruleMatchesCount)}
                        </span>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-xs">
                      {/* Vedi button (opens Blacklisted filtered on this rule) */}
                      <button
                        type="button"
                        aria-label={`${copy.rules.see} offerte regola ${rule.value}`}
                        onClick={() => onViewRulePostings(rule.id)}
                        className="inline-flex cursor-pointer items-center gap-xs rounded-full border border-border px-sm py-2xs text-caption text-foreground hover:border-primary hover:bg-muted"
                      >
                        <EyeIcon className="size-icon-xs text-muted-foreground" />
                        <span>{copy.rules.see}</span>
                      </button>

                      {/* Modifica button */}
                      <button
                        type="button"
                        aria-label={`${copy.rules.edit} regola ${rule.value}`}
                        onClick={() => handleStartEdit(rule)}
                        className="inline-flex cursor-pointer items-center gap-xs rounded-full border border-border px-sm py-2xs text-caption text-foreground hover:border-primary hover:bg-muted"
                      >
                        <PencilSimpleIcon className="size-icon-xs text-muted-foreground" />
                        <span>{copy.rules.edit}</span>
                      </button>

                      {/* Elimina button */}
                      <button
                        type="button"
                        aria-label={`${copy.rules.delete} regola ${rule.value}`}
                        onClick={() => setDeleteTarget(rule)}
                        className="inline-flex cursor-pointer items-center gap-xs rounded-full border border-border px-sm py-2xs text-caption text-foreground hover:border-danger hover:bg-muted"
                      >
                        <TrashIcon className="size-icon-xs text-muted-foreground" />
                        <span>{copy.rules.delete}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              scene={rules.length === 0 ? 'inbox' : 'search'}
              title={rules.length === 0 ? copy.rules.empty_rules : copy.rules.empty_filtered}
              description={rules.length === 0 ? copy.rules.empty_rules_desc : copy.rules.search_placeholder}
            />
          )}
        </div>
      </div>

      {/* Delete Rule Confirmation Dialog */}
      {deleteTarget && (
        <Dialog
          open={true}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null);
          }}
          size="sm"
          closeLabel={copy.rules.cancel}
          title={copy.rules.confirm_delete_title}
          description={copy.rules.confirm_delete_desc(deleteTarget.value)}
          footer={
            <div className="flex w-full justify-end gap-sm">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="cursor-pointer rounded-full border border-border px-md py-2xs text-label font-medium text-foreground hover:bg-muted"
              >
                {copy.rules.cancel}
              </button>
              <HoldButton
                {...copy.hold.rule}
                onConfirm={async () => {
                  const target = deleteTarget;
                  setDeleteTarget(null);
                  await onDeleteRule(target.id);
                }}
              />
            </div>
          }
        >
          <div />
        </Dialog>
      )}
    </div>
  );
}

// The native datalist opens as a separate window on Wayland, full height at the screen edge: this list stays under the field.
const MAX_SUGGESTIONS = 8;

function ValueField({
  value,
  onChange,
  suggestions,
}: {
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
}) {
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(-1);
  const query = value.trim().toLowerCase();
  const shown = query
    ? suggestions.filter((s) => s.toLowerCase().includes(query) && s.toLowerCase() !== query).slice(0, MAX_SUGGESTIONS)
    : [];
  const expanded = open && shown.length > 0;

  function pick(choice: string) {
    onChange(choice);
    setOpen(false);
    setActive(-1);
  }

  return (
    <div className="relative">
      <input
        id="rule-value"
        role="combobox"
        aria-label={copy.rules.value}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls="rule-value-suggestions"
        aria-activedescendant={expanded && active >= 0 ? `rule-value-option-${active}` : undefined}
        autoComplete="off"
        type="text"
        required
        placeholder={copy.rules.value_placeholder}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!expanded) return;
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const step = e.key === 'ArrowDown' ? 1 : -1;
            setActive((i) => (i + step + shown.length) % shown.length);
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            pick(shown[active]);
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
          }
        }}
        className="h-touch w-full rounded-lg border border-border bg-background px-sm text-label text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
      />
      {expanded && (
        <div
          id="rule-value-suggestions"
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- a native datalist opens as a separate window on Wayland
          role="listbox"
          aria-label={copy.rules.suggestions}
          className="absolute inset-x-0 top-full z-50 mt-2xs rounded-md border border-border bg-background p-2xs"
        >
          {shown.map((s, i) => (
            // oxlint-disable-next-line jsx-a11y/click-events-have-key-events -- keys are handled on the combobox input, which keeps focus // guard-private: allow Generic lint rule name
            <div
              key={s}
              id={`rule-value-option-${i}`}
              // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- options of the listbox above
              role="option"
              tabIndex={-1}
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(s)}
              onPointerEnter={() => setActive(i)}
              className={`flex min-h-touch cursor-pointer items-center rounded-sm px-sm text-label ${
                i === active ? 'bg-muted text-foreground' : 'text-muted-foreground'
              }`}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
