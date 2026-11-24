import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import * as React from 'react';
import { ActionButton } from '../../apps/web/src/components/ui/action-button.tsx';
import { Dialog } from '../../apps/web/src/components/ui/dialog.tsx';
import { HoldToConfirm } from '../../apps/web/src/components/ui/hold-to-confirm.tsx';
import { PillSelect } from '../../apps/web/src/components/ui/pill-select.tsx';
import { copy } from './copy.ts';
import type { DryRunRow } from './ingest.ts';
import type { JobRow, LavoroState } from './server.ts';
import { ScoreBadge } from './ui-common.tsx';

export function ProvaDialog({
  open,
  onOpenChange,
  state,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: LavoroState | null;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      closeLabel={copy.detail.close}
      title={copy.collection.prova_title}
      description={copy.collection.prova_subtitle}
    >
      <div className="flex flex-col divide-y">
        {state?.status === 'ready' && state.dryRun && state.dryRun.length > 0 ? (
          state.dryRun.map((card: DryRunRow, idx: number) => (
            <div key={idx} className="flex items-center justify-between py-sm">
              <div className="flex min-w-0 flex-col">
                <span className="text-label">{card.title}</span>
                <span className="text-caption text-muted-foreground">
                  {card.company} • {card.location} • {card.site}
                </span>
              </div>
              <ScoreBadge score={card.total} />
            </div>
          ))
        ) : (
          <EmptyState title={copy.collection.prova_empty} />
        )}
      </div>
    </Dialog>
  );
}

export function GroupConfirmDialog({
  groupAction,
  onClose,
  onConfirm,
}: {
  groupAction: { action: 'archive' | 'restore'; keys: string[] } | null;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  return (
    <Dialog
      open={groupAction !== null}
      onOpenChange={(open) => !open && onClose()}
      size="sm"
      title={
        groupAction?.action === 'archive'
          ? copy.actions.confirm_group_archive(groupAction.keys.length)
          : copy.actions.confirm_group_restore(groupAction?.keys.length ?? 0)
      }
      footer={
        <div className="flex items-center justify-end gap-sm">
          <button
            type="button"
            data-initial-focus
            onClick={onClose}
            className="min-h-touch cursor-pointer rounded-full border border-border px-lg text-label hover:bg-muted"
          >
            {copy.actions.cancel}
          </button>
          <ActionButton size="md" variant="primary" label="Conferma" action={onConfirm} />
        </div>
      }
    >
      <p className="text-label text-muted-foreground">
        {groupAction?.action === 'archive'
          ? `Verranno archiviate ${groupAction.keys.length} offerte.`
          : `Verranno ripristinate ${groupAction?.keys.length} offerte.`}
      </p>
    </Dialog>
  );
}

export function PurgeConfirmDialog({
  purgeKeys,
  onClose,
  onConfirm,
  previewJobs,
}: {
  purgeKeys: string[];
  onClose: () => void;
  onConfirm: (keys: string[]) => Promise<void>;
  previewJobs: JobRow[];
}) {
  return (
    <Dialog
      open={purgeKeys.length > 0}
      onOpenChange={(open) => !open && onClose()}
      size="md"
      title={copy.actions.confirm_purge_title}
      description={copy.actions.confirm_purge_description(purgeKeys.length)}
      footer={
        <div className="flex items-center justify-end gap-sm">
          <button
            type="button"
            data-initial-focus
            onClick={onClose}
            className="min-h-touch cursor-pointer rounded-full border border-border px-lg text-label hover:bg-muted"
          >
            {copy.actions.cancel}
          </button>
          <HoldToConfirm
            onConfirm={() => onConfirm(purgeKeys)}
            variant="primary"
            labels={{
              idle: copy.actions.delete_permanently,
              holding: copy.actions.holding_to_delete,
              pending: 'Eliminazione...',
              success: 'Eliminato',
              error: 'Riprova',
            }}
            className="text-danger-foreground bg-danger hover:bg-danger/90"
          />
        </div>
      }
    >
      <div className="my-sm flex flex-col divide-y rounded-lg border border-border bg-surface/50 p-xs">
        {previewJobs.map((j) => (
          <div key={j.key} className="px-sm py-xs">
            <span className="block text-label font-semibold">{j.title}</span>
            <span className="block text-caption text-muted-foreground">
              {j.company} • {j.location}
            </span>
          </div>
        ))}
      </div>
    </Dialog>
  );
}

export function ToastNotification({
  toast,
  onDismiss,
}: {
  toast: { message: string; undo?: () => Promise<void> } | null;
  onDismiss: () => void;
}) {
  if (!toast) return null;

  return (
    <output
      aria-live="polite"
      data-toast
      className="fixed bottom-xl left-1/2 z-50 flex -translate-x-1/2 items-center gap-md rounded-lg border border-border bg-surface px-md py-sm text-label text-foreground shadow-lg"
    >
      <span>{toast.message}</span>
      {toast.undo && (
        <button
          type="button"
          onClick={async () => {
            const undo = toast.undo;
            onDismiss();
            if (undo) await undo();
          }}
          className="cursor-pointer font-semibold text-primary hover:underline"
        >
          {copy.actions.undo}
        </button>
      )}
    </output>
  );
}

type OptionalWorkMode = 'remote' | 'hybrid' | 'onsite' | '';

function isOptionalWorkMode(value: string): value is OptionalWorkMode {
  return value === '' || value === 'remote' || value === 'hybrid' || value === 'onsite';
}

function fallbackImportUrl(): string {
  return `urn:import:${Date.now()}`;
}

function getString(obj: unknown, key: 'code' | 'key' | 'existingKey' | 'message'): string | undefined {
  if (typeof obj !== 'object' || obj === null) return undefined;
  if (key === 'code' && 'code' in obj && typeof obj.code === 'string') return obj.code;
  if (key === 'key' && 'key' in obj && typeof obj.key === 'string') return obj.key;
  if (key === 'existingKey' && 'existingKey' in obj && typeof obj.existingKey === 'string') return obj.existingKey;
  if (key === 'message' && 'message' in obj && typeof obj.message === 'string') return obj.message;
  return undefined;
}

function parseImportError(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const data = 'data' in err ? err.data : undefined;
  const shape = 'shape' in err ? err.shape : undefined;
  const shapeData = typeof shape === 'object' && shape !== null && 'data' in shape ? shape.data : undefined;
  const message = err instanceof Error ? err.message : getString(err, 'message');
  const code = getString(data, 'code') ?? getString(shapeData, 'code');
  const isConflict =
    code === 'CONFLICT' || (Boolean(message) && !message?.includes('Fetch failed') && !message?.includes('network'));
  return (
    getString(data, 'key') ??
    getString(data, 'existingKey') ??
    getString(shapeData, 'key') ??
    getString(shapeData, 'existingKey') ??
    (isConflict ? message : undefined) ??
    null
  );
}

export function ImportDialog({
  open,
  onOpenChange,
  onRead,
  onSave,
  onOpenDetail,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRead: (url: string) => Promise<{
    title: string;
    company: string;
    location: string;
    site: string;
    workMode: 'remote' | 'hybrid' | 'onsite' | null;
    applyUrl: string | null;
    description: string;
    descriptionHtml?: string;
  }>;
  onSave: (job: {
    url: string;
    title: string;
    company: string;
    location: string;
    site: string;
    workMode?: 'remote' | 'hybrid' | 'onsite' | null;
    applyUrl?: string | null;
    description?: string | null;
    descriptionHtml?: string | null;
  }) => Promise<{ key: string }>;
  onOpenDetail: (key: string) => void;
}) {
  const [url, setUrl] = React.useState('');
  const [reading, setReading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [duplicateKey, setDuplicateKey] = React.useState<string | null>(null);

  // Form fields
  const [title, setTitle] = React.useState('');
  const [company, setCompany] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [site, setSite] = React.useState('sito');
  const [workMode, setWorkMode] = React.useState<'remote' | 'hybrid' | 'onsite' | ''>('');
  const [applyUrl, setApplyUrl] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [descriptionHtml, setDescriptionHtml] = React.useState('');
  const [hasLoadedData, setHasLoadedData] = React.useState(false);

  const handleRead = async () => {
    if (!url.trim()) return;
    setReading(true);
    setReadError(null);
    setDuplicateKey(null);
    try {
      const data = await onRead(url.trim());
      setTitle(data.title ?? '');
      setCompany(data.company ?? '');
      setLocation(data.location ?? '');
      setSite(data.site || 'sito');
      setWorkMode(data.workMode ?? '');
      setApplyUrl(data.applyUrl ?? '');
      setDescription(data.description ?? '');
      setDescriptionHtml(data.descriptionHtml ?? '');
      setHasLoadedData(true);
    } catch {
      setReadError(copy.import.error_fetch);
    } finally {
      setReading(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !company.trim() || saving) return;
    setSaving(true);
    setDuplicateKey(null);
    try {
      await onSave({
        url: url.trim() || fallbackImportUrl(),
        title: title.trim(),
        company: company.trim(),
        location: location.trim(),
        site: site.trim() || 'sito',
        workMode: workMode ? workMode : null,
        applyUrl: applyUrl.trim() || null,
        description: description.trim() || null,
        descriptionHtml: descriptionHtml.trim() || null,
      });
      onOpenChange(false);
      reset();
    } catch (err: unknown) {
      const dupKey = parseImportError(err);
      if (dupKey) {
        setDuplicateKey(dupKey);
      } else {
        setReadError(copy.actions.toast_error);
      }
    } finally {
      setSaving(false);
    }
  };

  const reset = () => {
    setUrl('');
    setTitle('');
    setCompany('');
    setLocation('');
    setSite('sito');
    setWorkMode('');
    setApplyUrl('');
    setDescription('');
    setDescriptionHtml('');
    setHasLoadedData(false);
    setDuplicateKey(null);
    setReadError(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      size="lg"
      closeLabel={copy.detail.close}
      title={copy.import.title}
    >
      <form onSubmit={handleSave} className="flex flex-col gap-md">
        {/* URL Input and Read button */}
        <div className="flex flex-col gap-xs">
          <label htmlFor="import-url" className="text-caption font-medium text-foreground">
            {copy.import.url_label}
          </label>
          <div className="flex gap-sm">
            <input
              id="import-url"
              type="url"
              placeholder={copy.import.url_placeholder}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="h-touch flex-1 rounded-lg border border-border bg-background px-sm text-label text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
            />
            <button
              type="button"
              disabled={!url.trim() || reading}
              onClick={handleRead}
              className="inline-flex h-touch cursor-pointer items-center justify-center rounded-full border border-border bg-surface px-md text-label font-medium text-foreground hover:bg-muted disabled:cursor-default disabled:opacity-40"
            >
              {reading ? copy.import.reading : copy.import.read_button}
            </button>
          </div>
          {readError && <span className="text-caption text-danger">{readError}</span>}
        </div>

        {/* Duplicate Conflict Warning */}
        {duplicateKey && (
          <div className="border-warning/30 bg-warning/10 text-warning flex items-center justify-between gap-sm rounded-lg border p-sm text-label">
            <span>{copy.import.duplicate_conflict}</span>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                reset();
                onOpenDetail(duplicateKey);
              }}
              className="cursor-pointer font-semibold underline hover:text-foreground"
            >
              {copy.import.open_existing}
            </button>
          </div>
        )}

        {/* Editable fields */}
        {(hasLoadedData || url) && (
          <div className="flex flex-col gap-sm border-t border-border pt-md">
            <h3 className="text-label font-semibold text-foreground">{copy.import.fields_title}</h3>

            <div className="grid grid-cols-1 gap-sm md:grid-cols-2">
              <div className="flex flex-col gap-xs">
                <label htmlFor="import-title" className="text-caption font-medium text-foreground">
                  {copy.import.title_label}
                </label>
                <input
                  id="import-title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-touch rounded-lg border border-border bg-background px-sm text-label text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-xs">
                <label htmlFor="import-company" className="text-caption font-medium text-foreground">
                  {copy.import.company_label}
                </label>
                <input
                  id="import-company"
                  type="text"
                  required
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                  className="h-touch rounded-lg border border-border bg-background px-sm text-label text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-sm md:grid-cols-3">
              <div className="flex flex-col gap-xs">
                <label htmlFor="import-location" className="text-caption font-medium text-foreground">
                  {copy.import.location_label}
                </label>
                <input
                  id="import-location"
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="h-touch rounded-lg border border-border bg-background px-sm text-label text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-xs">
                <label htmlFor="import-site" className="text-caption font-medium text-foreground">
                  {copy.import.site_label}
                </label>
                <input
                  id="import-site"
                  type="text"
                  value={site}
                  onChange={(e) => setSite(e.target.value)}
                  className="h-touch rounded-lg border border-border bg-background px-sm text-label text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                />
              </div>

              <div className="flex flex-col gap-xs">
                <label className="text-caption font-medium text-foreground">{copy.import.work_mode_label}</label>
                <PillSelect
                  size="md"
                  block
                  label={copy.import.work_mode_label}
                  options={[
                    { value: '', label: 'Non specificato' },
                    { value: 'remote', label: 'Da remoto' },
                    { value: 'hybrid', label: 'Ibrido' },
                    { value: 'onsite', label: 'In sede' },
                  ]}
                  value={workMode}
                  onValueChange={(v) => {
                    if (isOptionalWorkMode(v)) setWorkMode(v);
                  }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-xs">
              <label htmlFor="import-apply-url" className="text-caption font-medium text-foreground">
                {copy.import.apply_url_label}
              </label>
              <input
                id="import-apply-url"
                type="url"
                value={applyUrl}
                onChange={(e) => setApplyUrl(e.target.value)}
                className="h-touch rounded-lg border border-border bg-background px-sm text-label text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
              />
            </div>

            <div className="flex flex-col gap-xs">
              <label htmlFor="import-desc" className="text-caption font-medium text-foreground">
                {copy.import.description_label}
              </label>
              <textarea
                id="import-desc"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="rounded-lg border border-border bg-background p-sm text-label text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
              />
            </div>

            <div className="flex justify-end gap-sm pt-sm">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="cursor-pointer rounded-full border border-border px-md py-2xs text-label font-medium text-foreground hover:bg-muted"
              >
                {copy.actions.cancel}
              </button>
              <button
                type="submit"
                disabled={!title.trim() || !company.trim() || saving}
                className="cursor-pointer rounded-full bg-primary px-lg py-2xs text-label font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-default disabled:opacity-40"
              >
                {copy.import.save_button}
              </button>
            </div>
          </div>
        )}
      </form>
    </Dialog>
  );
}

type EditPostingSave = (
  key: string,
  updated: {
    title: string;
    company: string;
    location: string;
    site: string;
    workMode: 'remote' | 'hybrid' | 'onsite' | null;
    score: number;
    total?: number;
    applyUrl: string | null;
    description: string | null;
    descriptionHtml?: string | null;
  },
) => Promise<void>;

export function EditPostingDialog({
  job,
  open,
  onOpenChange,
  onSave,
}: {
  job: JobRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: EditPostingSave;
}) {
  if (!job) return null;
  return <EditPostingForm key={job.key} job={job} open={open} onOpenChange={onOpenChange} onSave={onSave} />;
}

function EditPostingForm({
  job,
  open,
  onOpenChange,
  onSave,
}: {
  job: JobRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: EditPostingSave;
}) {
  const [title, setTitle] = React.useState(job.title);
  const [company, setCompany] = React.useState(job.company);
  const [location, setLocation] = React.useState(job.location);
  const [site] = React.useState(job.site);
  const [workMode, setWorkMode] = React.useState<OptionalWorkMode>(job.workMode ?? '');
  const [score, setScore] = React.useState<number>(job.total);
  const [applyUrl, setApplyUrl] = React.useState(job.applyUrl ?? '');
  const [description, setDescription] = React.useState(job.description ?? '');
  const [saving, setSaving] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !company.trim() || saving) return;
    setSaving(true);
    try {
      await onSave(job.key, {
        title: title.trim(),
        company: company.trim(),
        location: location.trim(),
        site: site.trim() || job.site,
        workMode: workMode ? workMode : null,
        score,
        total: score,
        applyUrl: applyUrl.trim() || null,
        description: description.trim() || null,
        descriptionHtml: job.descriptionHtml,
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" closeLabel={copy.detail.close} title={copy.edit.title}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-md">
        <div className="grid grid-cols-1 gap-sm md:grid-cols-2">
          <div className="flex flex-col gap-xs">
            <label htmlFor="edit-title" className="text-caption font-medium text-foreground">
              {copy.import.title_label}
            </label>
            <input
              id="edit-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-touch rounded-lg border border-border bg-background px-sm text-label text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-xs">
            <label htmlFor="edit-company" className="text-caption font-medium text-foreground">
              {copy.import.company_label}
            </label>
            <input
              id="edit-company"
              type="text"
              required
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="h-touch rounded-lg border border-border bg-background px-sm text-label text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-sm md:grid-cols-3">
          <div className="flex flex-col gap-xs">
            <label htmlFor="edit-location" className="text-caption font-medium text-foreground">
              {copy.import.location_label}
            </label>
            <input
              id="edit-location"
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="h-touch rounded-lg border border-border bg-background px-sm text-label text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-xs">
            <label className="text-caption font-medium text-foreground">{copy.import.work_mode_label}</label>
            <PillSelect
              size="md"
              block
              label={copy.import.work_mode_label}
              options={[
                { value: '', label: 'Non specificato' },
                { value: 'remote', label: 'Da remoto' },
                { value: 'hybrid', label: 'Ibrido' },
                { value: 'onsite', label: 'In sede' },
              ]}
              value={workMode}
              onValueChange={(v) => {
                if (isOptionalWorkMode(v)) setWorkMode(v);
              }}
            />
          </div>

          <div className="flex flex-col gap-xs">
            <label htmlFor="edit-score" className="text-caption font-medium text-foreground">
              {copy.edit.score_label}
            </label>
            <input
              id="edit-score"
              type="number"
              step="any"
              value={score}
              onChange={(e) => setScore(parseFloat(e.target.value) || 0)}
              className="h-touch rounded-lg border border-border bg-background px-sm text-label text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
            />
          </div>
        </div>

        <div className="flex flex-col gap-xs">
          <label htmlFor="edit-apply-url" className="text-caption font-medium text-foreground">
            {copy.import.apply_url_label}
          </label>
          <input
            id="edit-apply-url"
            type="url"
            value={applyUrl}
            onChange={(e) => setApplyUrl(e.target.value)}
            className="h-touch rounded-lg border border-border bg-background px-sm text-label text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
          />
        </div>

        <div className="flex flex-col gap-xs">
          <label htmlFor="edit-desc" className="text-caption font-medium text-foreground">
            {copy.import.description_label}
          </label>
          <textarea
            id="edit-desc"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="rounded-lg border border-border bg-background p-sm text-label text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
          />
        </div>

        <div className="flex justify-end gap-sm pt-sm">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer rounded-full border border-border px-md py-2xs text-label font-medium text-foreground hover:bg-muted"
          >
            {copy.actions.cancel}
          </button>
          <button
            type="submit"
            disabled={!title.trim() || !company.trim() || saving}
            className="cursor-pointer rounded-full bg-primary px-lg py-2xs text-label font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-default disabled:opacity-40"
          >
            {copy.edit.save_button}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
