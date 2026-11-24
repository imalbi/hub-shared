import { NumberRoll } from '../../apps/web/src/components/ui/number-roll.tsx';
import { Preparation } from './ui-notes.tsx';
import * as React from 'react';
import { Calendar as CalendarIcon, Check as CheckIcon, X as XIcon } from '@phosphor-icons/react';
import { HoldButton } from '../../apps/web/src/components/hold-button.tsx';
import { Badge } from '../../apps/web/src/components/ui/badge.tsx';
import { Dialog } from '../../apps/web/src/components/ui/dialog.tsx';
import { PillSelect } from '../../apps/web/src/components/ui/pill-select.tsx';
import { Tooltip } from '../../apps/web/src/components/ui/tooltip.tsx';
import { createModuleClient } from '../../apps/web/src/lib/module-client.ts';
import { isApplicationExpired } from './applications.ts';
import { copy } from './copy.ts';
import type { ApplicationStatus } from './schema.ts';
import type definition from './server.ts';
import type { InterviewRow, JobRow } from './server.ts';
import { MailSection } from './ui-mail-section.tsx';

function isApplicationStatus(value: string): value is ApplicationStatus {
  return (
    value === 'pending' ||
    value === 'interviewing' ||
    value === 'offer' ||
    value === 'rejected' ||
    value === 'withdrawn' ||
    value === 'expired'
  );
}

const statusOptions: Array<{ value: ApplicationStatus; label: string }> = [
  { value: 'pending', label: copy.candidature.status.pending },
  { value: 'interviewing', label: copy.candidature.status.interviewing },
  { value: 'offer', label: copy.candidature.status.offer },
  { value: 'rejected', label: copy.candidature.status.rejected },
  { value: 'withdrawn', label: copy.candidature.status.withdrawn },
  { value: 'expired', label: copy.candidature.status.expired },
];

function toDateString(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ApplicationPanel({
  job,
  now,
  onJobChange,
  onUnapply,
  onToast,
}: {
  job: JobRow;
  now: number;
  onJobChange: (updated: JobRow) => void;
  onUnapply: (key: string) => Promise<void>;
  onToast: (msg: string) => void;
}) {
  const client = React.useMemo(() => createModuleClient<typeof definition>('lavoro'), []);
  const app = job.application;

  // Local state for immediate responsiveness
  const [status, setStatus] = React.useState<ApplicationStatus>(app?.status ?? 'pending');
  const [notes, setNotes] = React.useState<string>(app?.notes ?? '');
  const [reason, setReason] = React.useState<string>(app?.reason ?? '');
  const [closedAt, setClosedAt] = React.useState<string>(
    app?.closedAt ? toDateString(app.closedAt) : toDateString(now),
  );
  const [interviews, setInterviews] = React.useState<InterviewRow[]>(app?.interviews ?? []);
  const [showConfirmUnapply, setShowConfirmUnapply] = React.useState(false);

  // New interview input state
  const [newDate, setNewDate] = React.useState<string>(toDateString(now));
  const [newLabel, setNewLabel] = React.useState<string>('');

  // Sync local fields when the application prop changes.
  const [syncedApp, setSyncedApp] = React.useState(app);
  if (app !== syncedApp) {
    setSyncedApp(app);
    if (app) {
      setStatus(app.status);
      setNotes(app.notes ?? '');
      setReason(app.reason ?? '');
      setClosedAt(app.closedAt ? toDateString(app.closedAt) : toDateString(now));
      setInterviews(app.interviews ?? []);
    }
  }

  // Debounced autosave for notes (700ms)
  const notesTimerRef = React.useRef<number | null>(null);

  async function saveNotes(val: string) {
    try {
      await client.setApplication.mutate({ key: job.key, notes: val });
      if (job.application) {
        onJobChange({
          ...job,
          application: { ...job.application, notes: val },
        });
      }
    } catch {
      onToast(copy.actions.toast_error);
    }
  }

  const handleNotesChange = (val: string) => {
    setNotes(val);
    if (notesTimerRef.current) window.clearTimeout(notesTimerRef.current);
    notesTimerRef.current = window.setTimeout(() => {
      void saveNotes(val);
    }, 700);
  };

  // Debounced autosave for reason (700ms)
  const reasonTimerRef = React.useRef<number | null>(null);

  async function saveReason(val: string) {
    try {
      await client.setApplication.mutate({ key: job.key, reason: val });
      if (job.application) {
        onJobChange({
          ...job,
          application: { ...job.application, reason: val },
        });
      }
    } catch {
      onToast(copy.actions.toast_error);
    }
  }

  const handleReasonChange = (val: string) => {
    setReason(val);
    if (reasonTimerRef.current) window.clearTimeout(reasonTimerRef.current);
    reasonTimerRef.current = window.setTimeout(() => {
      void saveReason(val);
    }, 700);
  };

  // Flush pending debounces on unmount
  React.useEffect(() => {
    return () => {
      if (notesTimerRef.current) {
        window.clearTimeout(notesTimerRef.current);
      }
      if (reasonTimerRef.current) {
        window.clearTimeout(reasonTimerRef.current);
      }
    };
  }, []);

  // Immediate save for status
  const handleStatusChange = async (nextStatus: ApplicationStatus) => {
    const prevStatus = status;
    setStatus(nextStatus);
    const isClosed = ['rejected', 'withdrawn', 'expired'].includes(nextStatus);
    const closedMs = isClosed ? new Date(closedAt).getTime() || now : null;

    try {
      await client.setApplication.mutate({
        key: job.key,
        status: nextStatus,
        closedAt: closedMs,
      });
      if (job.application) {
        onJobChange({
          ...job,
          application: {
            ...job.application,
            status: nextStatus,
            closedAt: closedMs,
          },
        });
      }
    } catch {
      setStatus(prevStatus);
      onToast(copy.actions.toast_error);
    }
  };

  // Immediate save for closed date
  const handleClosedAtChange = async (dateStr: string) => {
    setClosedAt(dateStr);
    const closedMs = new Date(dateStr).getTime();
    try {
      await client.setApplication.mutate({
        key: job.key,
        closedAt: closedMs,
      });
      if (job.application) {
        onJobChange({
          ...job,
          application: { ...job.application, closedAt: closedMs },
        });
      }
    } catch {
      onToast(copy.actions.toast_error);
    }
  };

  // Add interview
  const handleAddInterview = async () => {
    const label = newLabel.trim();
    if (!label) return;
    const scheduledAtMs = new Date(newDate).getTime() || now;

    try {
      const res = await client.addInterview.mutate({
        key: job.key,
        scheduledAt: scheduledAtMs,
        label,
      });
      const newInterview: InterviewRow = {
        id: res.id,
        key: job.key,
        scheduledAt: scheduledAtMs,
        label,
      };
      const updatedInterviews = [...interviews, newInterview].toSorted((a, b) => a.scheduledAt - b.scheduledAt);
      setInterviews(updatedInterviews);
      setNewLabel('');

      // If application was pending, server auto-transitioned to interviewing
      const nextStatus = status === 'pending' ? 'interviewing' : status;
      setStatus(nextStatus);

      if (job.application) {
        onJobChange({
          ...job,
          application: {
            ...job.application,
            status: nextStatus,
            interviews: updatedInterviews,
          },
        });
      }
    } catch {
      onToast(copy.actions.toast_error);
    }
  };

  // Delete interview
  const handleDeleteInterview = async (id: number) => {
    try {
      await client.deleteInterview.mutate({ id, confirmed: true });
      const updatedInterviews = interviews.filter((i) => i.id !== id);
      setInterviews(updatedInterviews);
      if (job.application) {
        onJobChange({
          ...job,
          application: { ...job.application, interviews: updatedInterviews },
        });
      }
    } catch {
      onToast(copy.actions.toast_error);
    }
  };

  if (!app) return null;

  const isClosed = ['rejected', 'withdrawn', 'expired'].includes(status);
  const showReason = ['rejected', 'withdrawn'].includes(status);
  const isAutoExpired = isApplicationExpired(app, now) && status === 'pending';

  return (
    <div className="flex flex-col gap-md rounded-xl border border-primary/20 bg-primary/5 p-md">
      <div className="flex items-center justify-between border-b border-border/40 pb-sm">
        <div className="flex items-center gap-xs">
          <CalendarIcon className="size-icon-sm text-primary" />
          <h3 className="text-label font-semibold text-foreground">{copy.candidature.panel.title}</h3>
          {isAutoExpired && (
            <Badge size="sm" tone="warning" outline>
              {`${copy.candidature.status.expired} (21 gg)`}
            </Badge>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowConfirmUnapply(true)}
          className="inline-flex cursor-pointer items-center gap-xs rounded-full border border-danger/40 px-sm py-2xs text-caption text-danger hover:bg-danger/10"
        >
          <XIcon className="size-icon-xs" />
          <span>{copy.candidature.panel.unapply}</span>
        </button>
      </div>

      {/* Status & Dates Row */}
      <div className="grid grid-cols-1 gap-md sm:grid-cols-2">
        <div className="flex flex-col gap-xs">
          <label htmlFor="app-status-select" className="text-caption text-muted-foreground">
            {copy.candidature.panel.status}
          </label>
          <PillSelect
            size="md"
            block
            label={copy.candidature.panel.status}
            options={statusOptions}
            value={status}
            onValueChange={(v) => {
              if (isApplicationStatus(v)) void handleStatusChange(v);
            }}
          />
          <select
            id="app-status-select"
            aria-label={copy.candidature.panel.status}
            value={status}
            onChange={(e) => {
              if (isApplicationStatus(e.target.value)) void handleStatusChange(e.target.value);
            }}
            className="sr-only"
            tabIndex={-1}
          >
            {statusOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-xs">
          <span className="text-caption text-muted-foreground">
            {isClosed ? copy.candidature.panel.closed_at : copy.candidature.panel.applied_at}
          </span>
          {isClosed ? (
            <input
              type="date"
              aria-label={copy.candidature.panel.closed_at}
              value={closedAt}
              onChange={(e) => void handleClosedAtChange(e.target.value)}
              className="h-touch rounded-lg border border-border/40 bg-surface/70 px-sm text-label text-foreground focus:border-primary/50 focus:outline-none"
            />
          ) : (
            <div className="flex h-touch items-center rounded-lg border border-border/40 bg-surface/40 px-sm text-label text-muted-foreground">
              {toDateString(app.appliedAt)}
            </div>
          )}
        </div>
      </div>

      {/* Reason (for rejected or withdrawn) */}
      {showReason && (
        <div className="flex flex-col gap-xs">
          <label htmlFor="app-reason" className="text-caption text-muted-foreground">
            {copy.candidature.panel.reason}
          </label>
          <input
            id="app-reason"
            type="text"
            value={reason}
            onChange={(e) => handleReasonChange(e.target.value)}
            placeholder="es. Retribuzione inadeguata, nessuna risposta..."
            className="h-touch rounded-lg border border-border/40 bg-surface/70 px-sm text-label text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none"
          />
        </div>
      )}

      {/* Notes Field */}
      <div className="flex flex-col gap-xs">
        <label htmlFor="app-notes" className="text-caption text-muted-foreground">
          {copy.candidature.panel.notes}
        </label>
        <textarea
          id="app-notes"
          rows={3}
          value={notes}
          onChange={(e) => handleNotesChange(e.target.value)}
          placeholder={copy.candidature.panel.notes_placeholder}
          className="rounded-lg border border-border/40 bg-surface/70 p-sm text-label text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none"
        />
      </div>

      {/* Interviews Section */}
      <div className="flex flex-col gap-sm border-t border-border/40 pt-sm">
        <div className="flex items-center justify-between">
          <span className="text-caption font-semibold text-foreground">
            {copy.candidature.interviews.title} (<NumberRoll value={interviews.length} />)
          </span>
        </div>

        {/* Existing Interviews */}
        {interviews.length > 0 && (
          <div className="flex flex-col divide-y divide-border/30 rounded-lg border border-border/30 bg-surface/50">
            {interviews.map((interview) => (
              <div key={interview.id} className="flex items-center justify-between gap-sm p-sm">
                <div className="flex min-w-0 items-center gap-sm">
                  <Badge size="sm" tone="primary" outline>
                    {toDateString(interview.scheduledAt)}
                  </Badge>
                  <span className="truncate text-label font-medium text-foreground">{interview.label ?? ''}</span>
                </div>
                <HoldButton
                  {...copy.hold.interview(interview.label ?? '')}
                  outline
                  onConfirm={() => handleDeleteInterview(interview.id)}
                />
              </div>
            ))}
          </div>
        )}

        {/* Add Interview Row */}
        <div className="flex flex-wrap items-center gap-xs">
          <input
            type="date"
            aria-label={copy.candidature.interviews.date}
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
            className="h-touch rounded-lg border border-border/40 bg-surface/70 px-sm text-caption text-foreground focus:border-primary/50 focus:outline-none"
          />
          <input
            type="text"
            aria-label={copy.candidature.interviews.title}
            placeholder={copy.candidature.interviews.placeholder_label}
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleAddInterview();
              }
            }}
            className="h-touch min-w-[180px] flex-1 rounded-lg border border-border/40 bg-surface/70 px-sm text-caption text-foreground placeholder:text-muted-foreground/50 focus:border-primary/50 focus:outline-none"
          />
          <Tooltip content={copy.candidature.interviews.add}>
            <button
              type="button"
              aria-label={copy.candidature.interviews.confirm_add}
              disabled={!newLabel.trim()}
              onClick={() => void handleAddInterview()}
              className="flex h-touch w-touch cursor-pointer items-center justify-center rounded-lg border border-primary bg-primary text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CheckIcon className="size-icon-sm" weight="bold" />
            </button>
          </Tooltip>
        </div>
      </div>

      <Preparation key={job.key} jobKey={job.key} />

      <MailSection job={job} />

      {/* Confirmation Dialog for Unapply */}
      <Dialog
        open={showConfirmUnapply}
        onOpenChange={setShowConfirmUnapply}
        size="sm"
        title={copy.candidature.panel.confirm_unapply_title}
        description={copy.candidature.panel.confirm_unapply_desc}
        footer={
          <div className="flex items-center justify-end gap-sm">
            <button
              type="button"
              data-initial-focus
              onClick={() => setShowConfirmUnapply(false)}
              className="min-h-touch cursor-pointer rounded-full border border-border px-lg text-label hover:bg-muted"
            >
              {copy.actions.cancel}
            </button>
            <HoldButton
              {...copy.hold.application}
              onConfirm={async () => {
                setShowConfirmUnapply(false);
                await onUnapply(job.key);
              }}
            />
          </div>
        }
      >
        <p className="text-label text-muted-foreground">
          {`Verrà rimossa la candidatura per "${job.title}" presso ${job.company}.`}
        </p>
      </Dialog>
    </div>
  );
}
