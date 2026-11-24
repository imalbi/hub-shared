import { Crossfade } from '../../apps/web/src/components/ui/crossfade.tsx';
import { TextMorph } from '../../apps/web/src/components/ui/text-morph.tsx';
import * as React from 'react';
import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react';
import { ActionButton } from '../../apps/web/src/components/ui/action-button.tsx';
import { Badge } from '../../apps/web/src/components/ui/badge.tsx';
import { Dialog } from '../../apps/web/src/components/ui/dialog.tsx';
import { Kbd } from '../../apps/web/src/components/ui/kbd.tsx';
import { Tooltip } from '../../apps/web/src/components/ui/tooltip.tsx';
import { RecordNotes } from '../../apps/web/src/components/record-notes.tsx';
import { setCurrentRecord } from '../../apps/web/src/lib/current-record.ts';
import { companyApplicationLine, copy } from './copy.ts';
import { formatRelativeDate } from './filters.ts';
import { isProtectedCategory } from './protected-category.ts';
import { extractSalary } from './salary.ts';
import { detailSummary, markTerms } from './summary.ts';
import type { JobRow, RuleRow } from './server.ts';
import { tabOf, type UserState } from './tabs.ts';
import {
  extractExperience,
  formatJobTitle,
  formatWorkMode,
  highlightHtmlText,
  MarkedText,
  sanitizeDescription,
  ScoreBadge,
} from './ui-common.tsx';
import { ToastNotification } from './ui-dialogs.tsx';
import { useDescriptionMarks } from './ui-marks.ts';
import { OpinionBlock } from './ui-opinion.tsx';

export type DetailDialogProps = {
  activeDetailJob: string | null;
  shownJob: JobRow | null;
  detailIndex: number;
  totalVisible: number;
  userState: UserState;
  rules: RuleRow[];
  now: number;
  toast: { message: string; undo?: () => Promise<void> } | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSetFlag: (
    keys: string[],
    flag: 'archived' | 'deleted' | 'applied',
    value: boolean,
    toastMsg: string,
    reverseMsg: string,
  ) => Promise<void>;
  onPurge: (keys: string[]) => void;
  onDismissToast: () => void;
  applicationPanel?: React.ReactNode;
  onExcludeCompany?: (company: string) => Promise<void>;
  onExcludePosting?: (key: string, title: string) => Promise<void>;
  onCustomRule?: (posting: JobRow) => void;
  onIncludeAgain?: (key: string) => Promise<void>;
  onOpenEdit?: (job: JobRow) => void;
  onPrepareCandidatura?: (key: string) => Promise<void>;
  onCopyCommand?: (key: string) => Promise<void>;
  onRefetchDescription?: (key: string) => Promise<void>;
};

export function DetailDialog({
  activeDetailJob,
  shownJob,
  detailIndex,
  totalVisible,
  userState,
  rules,
  now,
  toast,
  onClose,
  onPrev,
  onNext,
  onSetFlag,
  onPurge,
  onDismissToast,
  applicationPanel,
  onExcludeCompany,
  onExcludePosting,
  onCustomRule,
  onIncludeAgain,
  onOpenEdit,
  onPrepareCandidatura,
  onCopyCommand,
  onRefetchDescription,
}: DetailDialogProps) {
  const currentSegment = shownJob ? tabOf(shownJob, userState, rules) : null;
  const activeRule =
    shownJob !== null && shownJob.blacklistRule !== null ? rules.find((r) => r.id === shownJob.blacklistRule) : null;
  const hasHttpUrl = Boolean(shownJob?.url && shownJob.url.startsWith('http'));
  const isEmptyDescription = shownJob !== null && (shownJob.detailsMissing || !shownJob.description?.trim());
  const canRefetch =
    isEmptyDescription && currentSegment === 'review' && hasHttpUrl && onRefetchDescription !== undefined;
  const currentKey = shownJob?.key ?? null;
  const [blacklistOpenKey, setBlacklistOpenKey] = React.useState<string | null>(null);
  const blacklistOpen = currentKey !== null && blacklistOpenKey === currentKey;
  const blacklistRef = React.useRef<HTMLDivElement>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);

  const recordKey = activeDetailJob && shownJob ? shownJob.key : null;
  const recordTitle = shownJob ? formatJobTitle(shownJob.title) : '';
  React.useEffect(() => {
    if (!recordKey) return;
    setCurrentRecord({ source: 'lavoro-postings', id: recordKey, title: recordTitle });
    return () => setCurrentRecord(null);
  }, [recordKey, recordTitle]);

  React.useEffect(() => {
    if (!blacklistOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (blacklistRef.current && e.target instanceof Node && !blacklistRef.current.contains(e.target)) {
        setBlacklistOpenKey(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [blacklistOpen]);

  function footerActions(job: JobRow): { left: FooterAction[]; right: FooterAction[] } {
    const flag =
      (kind: 'archived' | 'deleted' | 'applied', value: boolean, toastMsg: string, reverseMsg: string) => () =>
        void onSetFlag([job.key], kind, value, toastMsg, reverseMsg);
    const isApp = Boolean(job.application);
    const left: FooterAction[] = [];
    const right: FooterAction[] = [];
    if (onOpenEdit) left.push({ id: 'edit', label: copy.detail.edit, onClick: () => onOpenEdit(job) });
    if (onExcludeCompany) {
      left.push({
        id: 'exclude-company',
        label: copy.detail.exclude_company,
        onClick: () => void onExcludeCompany(job.company),
      });
    }
    left.push({
      id: 'blacklist',
      label: copy.detail.blacklist_menu,
      expanded: blacklistOpen,
      onClick: () => setBlacklistOpenKey((prev) => (prev === currentKey ? null : currentKey)),
    });
    if (currentSegment === 'review' || isApp) {
      if (onPrepareCandidatura)
        left.push({
          id: 'prepare-candidatura',
          label: copy.detail.prepare_candidatura,
          kbd: 'P',
          onClick: () => void onPrepareCandidatura(job.key),
        });
      if (onCopyCommand)
        left.push({ id: 'copy-command', label: copy.detail.copy_command, onClick: () => void onCopyCommand(job.key) });
    }
    if (currentSegment === 'trash') {
      right.push(
        {
          id: 'restore',
          label: copy.actions.restore,
          onClick: flag('deleted', false, copy.actions.toast_restored(1), copy.actions.toast_trashed(1)),
        },
        {
          id: 'purge',
          label: copy.actions.delete_permanently,
          tone: 'danger',
          onClick: () => onPurge([job.key]),
        },
      );
      return { left, right };
    }
    if (currentSegment === 'blacklisted' && onIncludeAgain) {
      right.push({ id: 'include', label: copy.detail.include_again, onClick: () => void onIncludeAgain(job.key) });
    }
    right.push({
      id: 'trash',
      label: copy.detail.trash,
      kbd: 'X',
      onClick: flag('deleted', true, copy.actions.toast_trashed(1), copy.actions.toast_restored(1)),
    });
    if (currentSegment === 'review') {
      right.push({
        id: 'archive',
        label: copy.actions.archive,
        kbd: 'A',
        onClick: flag('archived', true, copy.actions.toast_archived(1), copy.actions.toast_restored(1)),
      });
    } else if (currentSegment === 'archive') {
      right.push({
        id: 'unarchive',
        label: copy.actions.restore,
        kbd: 'A',
        onClick: flag('archived', false, copy.actions.toast_restored(1), copy.actions.toast_archived(1)),
      });
    }
    right.push({
      id: 'apply',
      label: copy.actions.apply,
      kbd: 'C',
      pressed: isApp,
      tone: 'primary',
      onClick: flag(
        'applied',
        !isApp,
        isApp ? copy.actions.toast_unapplied : copy.actions.toast_applied,
        isApp ? copy.actions.toast_applied : copy.actions.toast_unapplied,
      ),
    });
    return { left, right };
  }

  const actions = shownJob ? footerActions(shownJob) : null;
  const shortcutActions = actions ? [...actions.left, ...actions.right].filter((a) => a.kbd) : [];
  const shortcutsRef = React.useRef(shortcutActions);
  React.useEffect(() => {
    shortcutsRef.current = shortcutActions;
  });
  const isOpen = activeDetailJob !== null && shownJob !== null;
  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      // Never while a field has focus, and never for a dialog stacked above this one (Modifica).
      if (target?.closest('input, textarea, select, [contenteditable]')) return;
      if (target?.closest('dialog')?.contains(rootRef.current) === false) return;
      const action = shortcutsRef.current.find((a) => a.kbd?.toLowerCase() === e.key.toLowerCase());
      if (!action) return;
      e.preventDefault();
      action.onClick();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- refs hold the latest shortcut actions and dialog root.
  }, [isOpen]);

  const terms = shownJob ? markTerms(shownJob) : [];
  const summary = shownJob ? detailSummary(shownJob) : [];
  const highlightedHtml = shownJob?.descriptionHtml
    ? highlightHtmlText(sanitizeDescription(shownJob.descriptionHtml), terms)
    : '';
  const descriptionRef = React.useRef<HTMLDivElement>(null);
  useDescriptionMarks(
    descriptionRef,
    activeDetailJob !== null && shownJob !== null,
    `${shownJob?.key}|${highlightedHtml}`,
  );

  return (
    <Dialog
      open={activeDetailJob !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      size="2xl"
      // The panel fills the viewport height (the Dialog's own max-height cuts it to 85%), so only the right column scrolls.
      className="h-dvh"
      closeLabel={copy.detail.close}
      title={<TextMorph animateWidth={false}>{shownJob ? formatJobTitle(shownJob.title) : ''}</TextMorph>}
      description={
        shownJob ? (
          <TextMorph
            animateWidth={false}
          >{`${shownJob.company} · ${shownJob.location} · ${shownJob.site} · ${formatRelativeDate(shownJob.postedAt ?? shownJob.firstSeen, now)}`}</TextMorph>
        ) : undefined
      }
      footer={
        actions && (
          <div className="-mx-lg -mt-md flex flex-1 flex-wrap items-center justify-between gap-sm border-t border-border px-lg pt-md">
            <div className="relative flex items-center gap-xs" ref={blacklistRef}>
              {actions.left.map((action) => (
                <FooterButton key={action.id} action={action} />
              ))}
              {blacklistOpen && shownJob && (
                <div className="min-w-48 shadow-dropdown absolute bottom-full left-0 z-10 mb-xs flex flex-col gap-xs rounded-lg border border-border bg-card p-xs">
                  <button
                    type="button"
                    onClick={() => {
                      setBlacklistOpenKey(null);
                      if (onExcludePosting) void onExcludePosting(shownJob.key, shownJob.title);
                    }}
                    className="cursor-pointer rounded-lg px-sm py-2xs text-left text-label text-foreground hover:bg-muted"
                  >
                    {copy.detail.exclude_posting}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBlacklistOpenKey(null);
                      if (onCustomRule) onCustomRule(shownJob);
                    }}
                    className="cursor-pointer rounded-lg px-sm py-2xs text-left text-label text-foreground hover:bg-muted"
                  >
                    {copy.detail.custom_rule}
                  </button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-xs">
              {actions.right.map((action) => (
                <FooterButton key={action.id} action={action} />
              ))}
            </div>
          </div>
        )
      }
    >
      {shownJob && (
        <div
          ref={rootRef}
          className="-mx-lg -my-xs flex h-full min-h-0 flex-col overflow-y-auto min-[1100px]:overflow-hidden"
        >
          {/* The Dialog's header has no slot for the counter and arrows: they sit left of its close button. */}
          <div className="absolute top-md right-2xl flex items-center gap-2xs">
            <span className="mr-xs text-caption text-muted-foreground">
              {copy.detail.position(detailIndex + 1, totalVisible)}
            </span>
            <Tooltip content={copy.detail.prev}>
              <button
                type="button"
                aria-label={copy.detail.prev}
                disabled={detailIndex <= 0}
                onClick={onPrev}
                className="flex size-xl cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-30"
              >
                <CaretLeftIcon className="size-icon" />
              </button>
            </Tooltip>
            <Tooltip content={copy.detail.next}>
              <button
                type="button"
                aria-label={copy.detail.next}
                disabled={detailIndex >= totalVisible - 1}
                onClick={onNext}
                className="flex size-xl cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-default disabled:opacity-30"
              >
                <CaretRightIcon className="size-icon" />
              </button>
            </Tooltip>
          </div>

          <div className="flex flex-wrap items-center gap-xs border-b border-border px-lg pb-sm text-caption text-muted-foreground">
            <ScoreBadge score={shownJob.total} />
            {extractSalary(shownJob.descriptionHtml ?? shownJob.description) && (
              <Badge size="sm" tone="success" outline>
                {extractSalary(shownJob.descriptionHtml ?? shownJob.description)!}
              </Badge>
            )}
            {extractExperience(shownJob.descriptionHtml ?? shownJob.description) && (
              <Badge size="sm" tone="warning" outline>
                {extractExperience(shownJob.descriptionHtml ?? shownJob.description)!}
              </Badge>
            )}
            {shownJob.workMode && (
              <Badge size="sm" tone="neutral">
                {formatWorkMode(shownJob.workMode)}
              </Badge>
            )}
            {shownJob.categories.map((c) => (
              <Badge key={c} size="sm" tone="neutral">
                {c}
              </Badge>
            ))}
          </div>

          <div className="flex min-h-0 flex-1 flex-col min-[1100px]:flex-row">
            {/* Left: the opinion first, the reasons for the listing at the bottom. */}
            <div className="flex flex-col gap-lg border-b border-border px-lg py-md min-[1100px]:w-2/5 min-[1100px]:shrink-0 min-[1100px]:overflow-y-auto min-[1100px]:border-r min-[1100px]:border-b-0">
              <Crossfade subject={shownJob.key}>
                <OpinionBlock jobKey={shownJob.key} />
              </Crossfade>

              {summary.length > 0 && (
                <div className="flex flex-col gap-2xs rounded-lg border border-border p-sm text-label">
                  {summary.map((row) => (
                    <div
                      key={row.id}
                      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- fieldset groups form controls; this is a labelled summary row.
                      role="group"
                      aria-label={row.label}
                      className="flex flex-wrap items-baseline gap-x-sm gap-y-3xs"
                    >
                      <span
                        className={`w-label-col shrink-0 text-caption font-medium ${row.id === 'exclude' ? 'text-danger' : row.id === 'favor' ? 'text-success' : 'text-muted-foreground'}`}
                      >
                        {row.label}
                      </span>
                      <span className="min-w-0 flex-1 text-foreground">{row.items.join(' · ')}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Status / Blacklist Rule Line */}
              {shownJob.blacklistRule !== null ? (
                <div className="rounded-lg border border-danger/20 bg-danger/10 p-sm text-label text-danger">
                  {copy.detail.blacklisted_rule(shownJob.blacklistRule, activeRule?.value ?? '')}
                </div>
              ) : isProtectedCategory(shownJob.title, shownJob.description) ? (
                <div className="rounded-lg border border-danger/20 bg-danger/10 p-sm text-label text-danger">
                  {copy.detail.protected_category}
                </div>
              ) : null}

              {shownJob.companyApplications.length > 0 && (
                <div className="flex flex-col gap-2xs text-caption text-muted-foreground">
                  <span className="font-medium text-foreground">{copy.already_applied.badge}</span>
                  {shownJob.companyApplications.map((app, i) => (
                    <span key={i}>{companyApplicationLine(app)}</span>
                  ))}
                </div>
              )}

              {/* Application Panel (if applied) */}
              {applicationPanel}

              {/* Perché è in lista (Reasons) */}
              {shownJob.reasons.length > 0 && (
                <div className="mt-auto flex flex-col gap-xs">
                  <h3 className="text-label">{copy.detail.why_listed}</h3>
                  <div className="flex flex-wrap gap-xs">
                    {shownJob.reasons.map((r, i) => (
                      <Badge key={i} size="sm" tone="neutral">
                        {r}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              <RecordNotes
                record={{ source: 'lavoro-postings', id: shownJob.key, title: formatJobTitle(shownJob.title) }}
              />
            </div>

            {/* Right: the posting, the only part that scrolls. */}
            <div className="flex min-w-0 flex-1 flex-col gap-xs px-lg py-md min-[1100px]:overflow-y-auto">
              <div className="flex min-h-touch items-center justify-between gap-sm">
                <h3 className="text-label">{copy.detail.listing}</h3>
                {hasHttpUrl && (
                  <a
                    href={shownJob.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cursor-pointer text-caption text-muted-foreground hover:text-foreground"
                  >
                    {copy.detail.open_original}
                  </a>
                )}
              </div>
              <div ref={descriptionRef}>
                <Crossfade subject={shownJob.key}>
                  <div data-posting-description="">
                    {isEmptyDescription ? (
                      <div className="flex flex-col items-start gap-sm">
                        <p className="text-label text-muted-foreground italic">{copy.detail.missing_details}</p>
                        {canRefetch && (
                          <ActionButton
                            size="sm"
                            variant="outline"
                            label={copy.detail.refetch_description}
                            labels={{ success: copy.detail.refetch_done, error: copy.detail.refetch_failed }}
                            action={() => onRefetchDescription(shownJob.key)}
                          />
                        )}
                      </div>
                    ) : shownJob.descriptionHtml ? (
                      <div
                        className="prose prose-sm dark:prose-invert relative max-w-none text-label"
                        /* oxlint-disable-next-line react/no-danger -- sanitized by clean-html.ts and escaped in ui-marks.ts */
                        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                      />
                    ) : (
                      <p className="relative text-label whitespace-pre-line text-foreground">
                        <MarkedText text={shownJob.description ?? ''} terms={terms} />
                      </p>
                    )}
                  </div>
                </Crossfade>
              </div>
            </div>
          </div>

          {/* Toast inside dialog so top-layer modal doesn't block clicks */}
          <ToastNotification toast={toast} onDismiss={onDismissToast} />
        </div>
      )}
    </Dialog>
  );
}

type FooterAction = {
  id: string;
  label: string;
  /** Shortcut shown on the button and handled while no field has focus. */
  kbd?: string;
  pressed?: boolean;
  expanded?: boolean;
  tone?: 'primary' | 'danger';
  onClick: () => void;
};

/** A named pill: the text is the accessible name, the key cap is decoration. */
function FooterButton({ action }: { action: FooterAction }) {
  const tone =
    action.tone === 'primary'
      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
      : `shadow-[inset_0_0_0_1px_var(--border)] hover:bg-muted ${action.tone === 'danger' ? 'text-danger' : 'text-foreground'}`;
  return (
    <button
      type="button"
      aria-pressed={action.pressed}
      aria-expanded={action.expanded}
      onClick={action.onClick}
      className={`inline-flex h-xl cursor-pointer items-center gap-xs rounded-full px-md text-label whitespace-nowrap ${tone}`}
    >
      {action.label}
      {action.kbd && (
        <span aria-hidden="true">
          <Kbd className={action.tone === 'primary' ? 'text-primary-foreground' : ''}>{action.kbd}</Kbd>
        </span>
      )}
    </button>
  );
}
