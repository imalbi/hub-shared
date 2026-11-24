import * as React from 'react';
import { z } from '../../apps/server/src/core/module.ts';
import { zoneSearch } from '../../apps/web/src/lib/zone-search.ts';
import { Badge } from '../../apps/web/src/components/ui/badge.tsx';
import { Tooltip } from '../../apps/web/src/components/ui/tooltip.tsx';
import { cleanHtml } from './clean-html.ts';
import { companyApplicationLine, copy } from './copy.ts';
import { applicationStatuses } from './application-status.ts';
import type { CompanyApplication } from './same-company.ts';
import { splitMarked, type MarkTerm } from './format.ts';
import { postingKey } from './key.ts';
import type { PostingGroupId } from './sort.ts';

export type AnnunciSegment = 'review' | 'archive' | 'blacklisted' | 'trash';

export const annunciSearchSchema = zoneSearch.extend({
  segment: z.enum(['review', 'archive', 'blacklisted', 'trash']).catch('review'),
  candidature: z.enum(['pending', 'interview', 'closed', 'all']).catch('pending'),
  status: z.enum(applicationStatuses).optional().catch(undefined),
  q: z.string().catch(''),
  globe: z.enum(['0', '1']).catch('0'),
  sort: z.enum(['opinion', 'score', 'newest', 'company', 'title']).catch('opinion'),
  job: z.string().optional().catch(undefined),
  rule: z.coerce.number().optional().catch(undefined),
  fs: z.enum(['today', '3d', '7d', '30d', 'always', 'custom']).catch('always'),
  score: z.coerce.number().optional().catch(undefined),
  modes: z.string().catch(''),
  sources: z.string().catch(''),
  cats: z.string().catch(''),
  locs: z.string().catch(''),
  companies: z.string().catch(''),
  adv_mode: z.enum(['all_words', 'exact_phrase', 'identical_field']).catch('all_words'),
  adv_whole: z.enum(['0', '1']).catch('0'),
  adv_title: z.string().catch(''),
  adv_company: z.string().catch(''),
  adv_desc: z.string().catch(''),
  adv_loc: z.string().catch(''),
});

export const emptyTitleBySegment: Record<AnnunciSegment, string> = {
  review: copy.empty.review_title,
  archive: copy.empty.archive_title,
  blacklisted: copy.empty.blacklisted_title,
  trash: copy.empty.trash_title,
};

export const emptyDescBySegment: Record<AnnunciSegment, string> = {
  review: copy.empty.review_description,
  archive: copy.empty.archive_description,
  blacklisted: copy.empty.blacklisted_description,
  trash: copy.empty.trash_description,
};

export const keyOf = postingKey;

export type ViewOptions = {
  layout: 'cards' | 'rows';
  columns: 'auto' | 1 | 2 | 3 | 4 | 5 | 6;
  minCardHeight: number;
  showDescription: boolean;
  showCategories: boolean;
  showScore: boolean;
  showDate: boolean;
  showMode: boolean;
  showState: boolean;
};

export const defaultViewOptions: ViewOptions = {
  layout: 'cards',
  columns: 'auto',
  minCardHeight: 140,
  showDescription: true,
  showCategories: true,
  showScore: true,
  showDate: true,
  showMode: true,
  showState: true,
};

export const sortOptions = [
  { value: 'opinion', label: copy.sort.opinion },
  { value: 'score', label: copy.sort.score },
  { value: 'newest', label: copy.sort.newest },
  { value: 'company', label: copy.sort.company },
  { value: 'title', label: copy.sort.title },
];

export const advancedModeOptions = [
  { value: 'all_words', label: copy.search.mode_all_words },
  { value: 'exact_phrase', label: copy.search.mode_exact_phrase },
  { value: 'identical_field', label: copy.search.mode_identical_field },
];

export const firstSeenOptions = [
  { value: 'always', label: copy.filters.first_seen_always },
  { value: 'today', label: copy.filters.first_seen_today },
  { value: '3d', label: copy.filters.first_seen_3d },
  { value: '7d', label: copy.filters.first_seen_7d },
  { value: '30d', label: copy.filters.first_seen_30d },
];

export const columnOptions = [
  { value: 'auto', label: copy.view_options.columns_auto },
  { value: '1', label: '1' },
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
  { value: '5', label: '5' },
  { value: '6', label: '6' },
];

export function workModeLabel(mode: 'remote' | 'hybrid' | 'onsite'): string {
  if (mode === 'remote') return copy.filters.mode_remote;
  if (mode === 'hybrid') return copy.filters.mode_hybrid;
  return copy.filters.mode_onsite;
}

export function parseColumns(value: string): ViewOptions['columns'] {
  const columns = Number(value);
  return columns === 1 || columns === 2 || columns === 3 || columns === 4 || columns === 5 || columns === 6
    ? columns
    : 'auto';
}

export function loadStoredView(): ViewOptions {
  try {
    const raw = localStorage.getItem('hub.lavoro.view');
    if (raw) return { ...defaultViewOptions, ...JSON.parse(raw) };
  } catch {
    // Ignore storage errors
  }
  return defaultViewOptions;
}

const groupStoreKey = 'hub.lavoro.open-groups';

/** Which closed groups are open: kept for the session only, so a reload keeps them and a new session starts closed. */
export function loadOpenGroups(): ReadonlySet<PostingGroupId> {
  try {
    const raw: unknown = JSON.parse(sessionStorage.getItem(groupStoreKey) ?? '[]');
    const parsed = z.array(z.string()).parse(raw);
    return new Set<PostingGroupId>(parsed.includes('fuori') ? ['fuori'] : []);
  } catch {
    return new Set();
  }
}

export function saveOpenGroups(open: ReadonlySet<PostingGroupId>) {
  try {
    sessionStorage.setItem(groupStoreKey, JSON.stringify([...open]));
  } catch {
    // Ignore storage errors
  }
}

export function saveStoredView(opts: ViewOptions) {
  try {
    localStorage.setItem('hub.lavoro.view', JSON.stringify(opts));
  } catch {
    // Ignore storage errors
  }
}

export function sanitizeDescription(rawHtml: string): string {
  if (typeof DOMParser === 'undefined') {
    return rawHtml.replaceAll(/<[^>]*>/g, ' ');
  }
  const doc = new DOMParser().parseFromString(rawHtml, 'text/html');
  return cleanHtml(doc, rawHtml).html;
}

export function HighlightText({ text, terms }: { text: string; terms: readonly string[] }) {
  if (!terms.length || !text) return <>{text}</>;
  const pattern = new RegExp(`(${terms.map((t) => t.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  const parts = text.split(pattern);
  return (
    <>
      {parts.map((part, index) =>
        terms.some((t) => t.toLowerCase() === part.toLowerCase()) ? (
          <mark key={index} className="rounded-sm bg-accent/25 px-3xs text-foreground">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

export { cleanSnippet, extractExperience, formatJobTitle, formatWorkMode, highlightHtmlText } from './format.ts';

/** Plain text with `data-mark` words, the same markup `highlightHtmlText` writes; the detail draws its marks over them. */
export function MarkedText({ text, terms }: { text: string; terms: readonly MarkTerm[] }) {
  return (
    <>
      {splitMarked(text, terms).map((part, index) =>
        part.mark ? (
          <span key={index} data-mark={part.mark}>
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  let toneClass = 'bg-muted text-muted-foreground font-medium';
  if (score >= 18) {
    toneClass = 'bg-success/15 text-success border border-success/30 font-bold';
  } else if (score >= 12) {
    toneClass = 'bg-accent/15 text-accent border border-accent/30 font-semibold';
  } else if (score >= 7) {
    toneClass = 'bg-muted text-foreground/80 border border-border/60 font-medium';
  } else {
    toneClass = 'bg-danger/10 text-danger/80 border border-danger/20 font-medium';
  }
  return (
    <Tooltip content={copy.interest.tooltip}>
      <span
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- styled text badge, not an image file
        role="img"
        aria-label={copy.interest.name(score)}
        className={`inline-flex items-center rounded-full px-xs py-3xs text-caption tabular-nums ${toneClass}`}
      >
        {score}
      </span>
    </Tooltip>
  );
}

export const VALID_WORK_MODES = new Set(['remote', 'hybrid', 'onsite'] as const);
export type ValidWorkMode = 'remote' | 'hybrid' | 'onsite';

export function isValidWorkMode(value: string): value is ValidWorkMode {
  return value === 'remote' || value === 'hybrid' || value === 'onsite';
}

const TOOLTIP_ENTRIES = 3;

/** Quiet marker for a posting whose company already has an application of the owner's. */
export function AlreadyAppliedBadge({ applications }: { applications: CompanyApplication[] }) {
  if (applications.length === 0) return null;
  const hidden = applications.length - TOOLTIP_ENTRIES;
  return (
    <Tooltip
      content={
        <span className="flex flex-col">
          {applications.slice(0, TOOLTIP_ENTRIES).map((app, i) => (
            <span key={i}>{companyApplicationLine(app)}</span>
          ))}
          {hidden > 0 && <span>{copy.already_applied.more(hidden)}</span>}
        </span>
      }
    >
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- keyboard focus target for the tooltip trigger -- guard-private: allow Generic lint rule name */}
      <span tabIndex={0} className="inline-flex rounded-full">
        <Badge size="sm" tone="neutral" outline>
          {copy.already_applied.badge}
        </Badge>
      </span>
    </Tooltip>
  );
}
