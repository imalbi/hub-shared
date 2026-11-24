import * as React from 'react';
import {
  Archive as ArchiveIcon,
  ArrowCounterClockwise as ArrowCounterClockwiseIcon,
  ArrowSquareOutIcon,
  Check as CheckIcon,
  Trash as TrashIcon,
} from '@phosphor-icons/react';
import { Badge } from '../../apps/web/src/components/ui/badge.tsx';
import { Tooltip } from '../../apps/web/src/components/ui/tooltip.tsx';
import { codeLabels, copy } from './copy.ts';
import { formatRelativeDate } from './filters.ts';
import { isProtectedCategory } from './protected-category.ts';
import { extractSalary } from './salary.ts';
import type { JobRow, RuleRow } from './server.ts';
import { tabOf, type UserState } from './tabs.ts';
import {
  cleanSnippet,
  extractExperience,
  formatJobTitle,
  AlreadyAppliedBadge,
  formatWorkMode,
  HighlightText,
  ScoreBadge,
  type ViewOptions,
} from './ui-common.tsx';

export function OpinionBadge({
  opinion,
}: {
  opinion: Pick<NonNullable<JobRow['opinion']>, 'possibility' | 'codes' | 'outdated'>;
}) {
  const labels = opinion.codes.map((code) => codeLabels[code]).join(', ');
  const label = copy.possibility[opinion.possibility];
  const name = `Parere: ${copy.stats.opinions[opinion.possibility]}${labels ? `, motivi ${labels}` : ''}`;
  const tone = opinion.possibility === 'alta' ? 'success' : opinion.possibility === 'media' ? 'warning' : 'neutral';
  const badge = (
    <Badge
      size="sm"
      tone={tone}
      outline={opinion.possibility !== 'alta'}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- styled text badge, not an image file
      role="img"
      aria-label={name}
      className={opinion.outdated ? 'opacity-50' : ''}
    >
      {label}
    </Badge>
  );
  return <>{opinion.outdated ? <Tooltip content={copy.pareri.outdated}>{badge}</Tooltip> : badge}</>;
}

export type PostingItemProps = {
  job: JobRow;
  viewOpts: ViewOptions;
  now: number;
  rules: RuleRow[];
  userState: UserState;
  isGlobe: boolean;
  highlightTermsList: string[];
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
};

export function PostingCard({
  job,
  viewOpts,
  now,
  rules,
  userState,
  isGlobe,
  highlightTermsList,
  onOpenDetail,
  onSetFlag,
  onPurge,
  onIncludeAgain,
}: PostingItemProps) {
  const rule = rules.find((r) => r.id === job.blacklistRule);
  const jobSegment = tabOf(job, userState, rules);
  const salary = extractSalary(job.descriptionHtml ?? job.description);
  const experience = extractExperience(job.descriptionHtml ?? job.description);

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- card holds nested links and action buttons; div.group stays intact for E2E. // guard-private: allow Generic lint rule name
    <div
      data-posting-key={job.key}
      onClick={() => onOpenDetail(job.key)}
      style={{ minHeight: `${viewOpts.minCardHeight}px` }}
      className="group relative flex h-full cursor-pointer flex-col justify-between rounded-xl border border-border bg-surface p-md transition-shadow select-none hover:shadow-md"
    >
      <div className="flex flex-col gap-xs">
        {/* Card Header: Source, Date, Score, Archivia/Ripristina */}
        <div className="flex items-center justify-between text-caption text-muted-foreground">
          <div className="flex min-w-0 items-center gap-xs">
            <span className="truncate font-medium text-foreground">{job.site}</span>
            {viewOpts.showDate && (
              <span className="shrink-0 whitespace-nowrap">
                • {formatRelativeDate(job.postedAt ?? job.firstSeen, now)}
              </span>
            )}
          </div>
          <div className="flex items-center gap-xs">
            {viewOpts.showScore && <ScoreBadge score={job.total} />}
            {job.opinion && <OpinionBadge opinion={job.opinion} />}
            {jobSegment === 'review' && (
              <Tooltip content={copy.actions.archive}>
                <button
                  type="button"
                  aria-label={`${copy.actions.archive} ${job.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onSetFlag(
                      [job.key],
                      'archived',
                      true,
                      copy.actions.toast_archived(1),
                      copy.actions.toast_restored(1),
                    );
                  }}
                  className="cursor-pointer rounded-full p-2xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ArchiveIcon className="size-icon-sm" />
                </button>
              </Tooltip>
            )}
            {jobSegment === 'archive' && (
              <Tooltip content={copy.actions.restore}>
                <button
                  type="button"
                  aria-label={`${copy.actions.restore} ${job.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onSetFlag(
                      [job.key],
                      'archived',
                      false,
                      copy.actions.toast_restored(1),
                      copy.actions.toast_archived(1),
                    );
                  }}
                  className="cursor-pointer rounded-full p-2xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ArrowCounterClockwiseIcon className="size-icon-sm" />
                </button>
              </Tooltip>
            )}
            {jobSegment === 'blacklisted' && onIncludeAgain && (
              <Tooltip content={copy.detail.include_again}>
                <button
                  type="button"
                  aria-label={`${copy.detail.include_again} ${job.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void onIncludeAgain(job.key);
                  }}
                  className="cursor-pointer rounded-full p-2xs text-primary hover:bg-primary/10"
                >
                  <ArrowCounterClockwiseIcon className="size-icon-sm" />
                </button>
              </Tooltip>
            )}
          </div>
        </div>

        {/* Title & Company */}
        <div className="mt-xs flex min-w-0 flex-col">
          <h4 className="truncate text-body font-semibold text-foreground group-hover:text-primary">
            <HighlightText text={formatJobTitle(job.title)} terms={highlightTermsList} />
          </h4>
          <span className="truncate text-caption text-muted-foreground">
            <HighlightText text={[job.company, job.location].filter(Boolean).join(' • ')} terms={highlightTermsList} />
          </span>
        </div>

        {/* Badges: Work mode, categories */}
        <div className="mt-xs flex flex-wrap gap-xs">
          {salary && (
            <Badge size="sm" tone="success" outline>
              {salary}
            </Badge>
          )}
          {experience && (
            <Badge size="sm" tone="warning" outline>
              {experience}
            </Badge>
          )}
          {viewOpts.showMode && job.workMode && (
            <Badge size="sm" tone="neutral">
              {formatWorkMode(job.workMode)}
            </Badge>
          )}
          {viewOpts.showCategories &&
            job.categories.map((cat) => (
              <Badge key={cat} size="sm" tone="neutral">
                {cat}
              </Badge>
            ))}
          <AlreadyAppliedBadge applications={job.companyApplications} />
          {isGlobe && (
            <Badge size="sm" tone="warning" outline>
              {copy.segments[tabOf(job, userState, rules)]}
            </Badge>
          )}
        </div>

        {job.opinion && job.opinion.unverified.length > 0 && (
          <span className="truncate text-caption text-muted-foreground">
            {copy.pareri.ask(job.opinion.unverified.join(', '))}
          </span>
        )}

        {/* Description preview */}
        {viewOpts.showDescription && job.description && (
          <p className="mt-xs line-clamp-2 text-caption text-muted-foreground">
            <HighlightText text={cleanSnippet(job.description)} terms={highlightTermsList} />
          </p>
        )}

        {/* Blacklist rule label */}
        {job.blacklistRule !== null ? (
          <span className="mt-xs text-caption font-medium text-danger">
            {copy.detail.blacklisted_rule(job.blacklistRule, rule?.value ?? '')}
          </span>
        ) : isProtectedCategory(job.title, job.description) ? (
          <span className="mt-xs text-caption font-medium text-danger">{copy.detail.protected_category}</span>
        ) : null}
      </div>
      {/* Card Action Area */}
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- isolates nested controls from the card click. -- guard-private: allow Generic lint rule name */}
      <div
        className="mt-sm flex items-center justify-between border-t border-border pt-xs"
        onClick={(e) => e.stopPropagation()}
      >
        {job.url && job.url.startsWith('http') ? (
          <Tooltip content={copy.detail.open_original}>
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${copy.detail.open_original} ${job.title}`}
              className="inline-flex cursor-pointer items-center justify-center rounded-full p-2xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ArrowSquareOutIcon className="size-icon-sm" />
            </a>
          </Tooltip>
        ) : (
          <span />
        )}

        <div className="flex items-center gap-xs">
          {jobSegment !== 'trash' ? (
            <>
              <Tooltip content={job.application ? copy.actions.applied : copy.actions.apply}>
                <button
                  type="button"
                  aria-label={`${copy.actions.apply} ${job.title}`}
                  aria-pressed={Boolean(job.application)}
                  onClick={() => {
                    const isApp = Boolean(job.application);
                    void onSetFlag(
                      [job.key],
                      'applied',
                      !isApp,
                      !isApp ? copy.actions.toast_applied : copy.actions.toast_unapplied,
                      isApp ? copy.actions.toast_applied : copy.actions.toast_unapplied,
                    );
                  }}
                  className={`cursor-pointer rounded-full p-2xs transition-colors ${
                    job.application
                      ? 'bg-success/15 text-success hover:bg-success/20'
                      : 'text-muted-foreground hover:bg-success/10 hover:text-success'
                  }`}
                >
                  <CheckIcon className="size-icon-sm" weight={job.application ? 'bold' : 'regular'} />
                </button>
              </Tooltip>
              <Tooltip content={copy.actions.trash}>
                <button
                  type="button"
                  aria-label={`${copy.actions.trash} ${job.title}`}
                  onClick={() => {
                    void onSetFlag(
                      [job.key],
                      'deleted',
                      true,
                      copy.actions.toast_trashed(1),
                      copy.actions.toast_restored(1),
                    );
                  }}
                  className="cursor-pointer rounded-full p-2xs text-muted-foreground hover:bg-muted hover:text-danger"
                >
                  <TrashIcon className="size-icon-sm" />
                </button>
              </Tooltip>
            </>
          ) : (
            <>
              <Tooltip content={copy.actions.restore}>
                <button
                  type="button"
                  aria-label={`${copy.actions.restore} ${job.title}`}
                  onClick={() => {
                    void onSetFlag(
                      [job.key],
                      'deleted',
                      false,
                      copy.actions.toast_restored(1),
                      copy.actions.toast_trashed(1),
                    );
                  }}
                  className="cursor-pointer rounded-full p-2xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ArrowCounterClockwiseIcon className="size-icon-sm" />
                </button>
              </Tooltip>
              <button
                type="button"
                aria-label={`${copy.actions.delete_permanently} ${job.title}`}
                onClick={() => onPurge([job.key])}
                className="cursor-pointer rounded-full px-xs py-2xs text-caption font-medium text-danger hover:bg-danger/10"
              >
                {copy.actions.delete_permanently}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function PostingRow({
  job,
  viewOpts,
  now,
  rules,
  userState,
  isGlobe,
  highlightTermsList,
  onOpenDetail,
  onSetFlag,
  onPurge,
  onIncludeAgain,
}: PostingItemProps) {
  const rule = rules.find((r) => r.id === job.blacklistRule);
  const jobSegment = tabOf(job, userState, rules);
  const salary = extractSalary(job.descriptionHtml ?? job.description);
  const experience = extractExperience(job.descriptionHtml ?? job.description);

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- card holds nested links and action buttons; div.group stays intact for E2E. // guard-private: allow Generic lint rule name
    <div
      data-posting-key={job.key}
      onClick={() => onOpenDetail(job.key)}
      className="group flex cursor-pointer flex-col justify-between gap-sm rounded-lg border border-border bg-surface px-md py-sm transition-colors select-none hover:border-accent/40 md:flex-row md:items-center"
    >
      <div className="flex min-w-0 items-center gap-md">
        <div className="flex min-w-0 flex-col">
          <div className="flex items-center gap-sm">
            <h4 className="truncate text-label font-medium text-foreground group-hover:text-primary">
              <HighlightText text={formatJobTitle(job.title)} terms={highlightTermsList} />
            </h4>
            {viewOpts.showScore && <ScoreBadge score={job.total} />}
            {job.opinion && <OpinionBadge opinion={job.opinion} />}
            {isGlobe && (
              <Badge size="sm" tone="warning" outline>
                {copy.segments[tabOf(job, userState, rules)]}
              </Badge>
            )}
          </div>
          <span className="truncate text-caption text-muted-foreground">
            <HighlightText text={[job.company, job.location].filter(Boolean).join(' • ')} terms={highlightTermsList} />
            {viewOpts.showDate && ` • ${formatRelativeDate(job.postedAt ?? job.firstSeen, now)}`}
          </span>
          {job.blacklistRule !== null ? (
            <span className="text-caption font-medium text-danger">
              {copy.detail.blacklisted_rule(job.blacklistRule, rule?.value ?? '')}
            </span>
          ) : isProtectedCategory(job.title, job.description) ? (
            <span className="text-caption font-medium text-danger">{copy.detail.protected_category}</span>
          ) : null}
        </div>
      </div>
      {/* oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- isolates nested controls from the row click. -- guard-private: allow Generic lint rule name */}
      <div
        className="flex shrink-0 items-center justify-between gap-md border-t border-border pt-xs md:border-t-0 md:pt-0"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-xs">
          {salary && (
            <Badge size="sm" tone="success" outline>
              {salary}
            </Badge>
          )}
          {experience && (
            <Badge size="sm" tone="warning" outline>
              {experience}
            </Badge>
          )}
          {viewOpts.showMode && job.workMode && (
            <Badge size="sm" tone="neutral">
              {formatWorkMode(job.workMode)}
            </Badge>
          )}
          {viewOpts.showCategories &&
            job.categories.slice(0, 2).map((cat) => (
              <Badge key={cat} size="sm" tone="neutral">
                {cat}
              </Badge>
            ))}
          <AlreadyAppliedBadge applications={job.companyApplications} />
        </div>

        <div className="flex items-center gap-xs">
          {job.url && job.url.startsWith('http') && (
            <Tooltip content={copy.detail.open_original}>
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-full p-2xs text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={`${copy.detail.open_original} ${job.title}`}
              >
                <ArrowSquareOutIcon className="size-icon-sm" />
              </a>
            </Tooltip>
          )}

          {jobSegment === 'review' && (
            <Tooltip content={copy.actions.archive}>
              <button
                type="button"
                aria-label={`${copy.actions.archive} ${job.title}`}
                onClick={() => {
                  void onSetFlag(
                    [job.key],
                    'archived',
                    true,
                    copy.actions.toast_archived(1),
                    copy.actions.toast_restored(1),
                  );
                }}
                className="cursor-pointer rounded-full p-2xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ArchiveIcon className="size-icon-sm" />
              </button>
            </Tooltip>
          )}
          {jobSegment === 'archive' && (
            <Tooltip content={copy.actions.restore}>
              <button
                type="button"
                aria-label={`${copy.actions.restore} ${job.title}`}
                onClick={() => {
                  void onSetFlag(
                    [job.key],
                    'archived',
                    false,
                    copy.actions.toast_restored(1),
                    copy.actions.toast_archived(1),
                  );
                }}
                className="cursor-pointer rounded-full p-2xs text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ArrowCounterClockwiseIcon className="size-icon-sm" />
              </button>
            </Tooltip>
          )}

          {jobSegment === 'blacklisted' && onIncludeAgain && (
            <Tooltip content={copy.detail.include_again}>
              <button
                type="button"
                aria-label={`${copy.detail.include_again} ${job.title}`}
                onClick={() => {
                  void onIncludeAgain(job.key);
                }}
                className="cursor-pointer rounded-full p-2xs text-primary hover:bg-primary/10"
              >
                <ArrowCounterClockwiseIcon className="size-icon-sm" />
              </button>
            </Tooltip>
          )}

          {jobSegment !== 'trash' ? (
            <>
              <Tooltip content={job.application ? copy.actions.applied : copy.actions.apply}>
                <button
                  type="button"
                  aria-label={`${copy.actions.apply} ${job.title}`}
                  aria-pressed={Boolean(job.application)}
                  onClick={() => {
                    const isApp = Boolean(job.application);
                    void onSetFlag(
                      [job.key],
                      'applied',
                      !isApp,
                      !isApp ? copy.actions.toast_applied : copy.actions.toast_unapplied,
                      isApp ? copy.actions.toast_applied : copy.actions.toast_unapplied,
                    );
                  }}
                  className={`cursor-pointer rounded-full p-2xs transition-colors ${
                    job.application
                      ? 'bg-success/15 text-success hover:bg-success/20'
                      : 'text-muted-foreground hover:bg-success/10 hover:text-success'
                  }`}
                >
                  <CheckIcon className="size-icon-sm" weight={job.application ? 'bold' : 'regular'} />
                </button>
              </Tooltip>
              <Tooltip content={copy.actions.trash}>
                <button
                  type="button"
                  aria-label={`${copy.actions.trash} ${job.title}`}
                  onClick={() => {
                    void onSetFlag(
                      [job.key],
                      'deleted',
                      true,
                      copy.actions.toast_trashed(1),
                      copy.actions.toast_restored(1),
                    );
                  }}
                  className="cursor-pointer rounded-full p-2xs text-muted-foreground hover:bg-muted hover:text-danger"
                >
                  <TrashIcon className="size-icon-sm" />
                </button>
              </Tooltip>
            </>
          ) : (
            <>
              <Tooltip content={copy.actions.restore}>
                <button
                  type="button"
                  aria-label={`${copy.actions.restore} ${job.title}`}
                  onClick={() => {
                    void onSetFlag(
                      [job.key],
                      'deleted',
                      false,
                      copy.actions.toast_restored(1),
                      copy.actions.toast_trashed(1),
                    );
                  }}
                  className="cursor-pointer rounded-full p-2xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <ArrowCounterClockwiseIcon className="size-icon-sm" />
                </button>
              </Tooltip>
              <button
                type="button"
                aria-label={`${copy.actions.delete_permanently} ${job.title}`}
                onClick={() => onPurge([job.key])}
                className="cursor-pointer rounded-full px-xs py-2xs text-caption font-medium text-danger hover:bg-danger/10"
              >
                {copy.actions.delete_permanently}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
