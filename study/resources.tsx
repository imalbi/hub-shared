import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { Panel } from '../../apps/web/src/components/panel.tsx';
import { RegistryButton } from '../../apps/web/src/components/registry-button.tsx';
import { Dialog } from '../../apps/web/src/components/ui/dialog.tsx';
import { Input } from '../../apps/web/src/components/ui/input.tsx';
import { Select } from '../../apps/web/src/components/ui/select.tsx';
import { LoadingSkeleton } from '../../apps/web/src/components/ui/loading-skeleton.tsx';
import { m } from './copy.ts';
import { MaterialAction } from './material.tsx';
import { ResourceNote, useResourceDraft } from './resource-note.tsx';
import { dirtyResourceDraft } from './resource-draft.ts';
import { useStudyTRPC, type StudyResource } from './use-study.ts';

export type ResourceScope = { planId: string; subjectId: string };
export type ResourcePdf = { path: string; folder: number };

export function useResourceSubject() {
  const trpc = useStudyTRPC();
  const subjects = useQuery(trpc.resourceSubjects.queryOptions());
  const index = useQuery(trpc.index.queryOptions());
  const search = useSearch({ strict: false });
  const requested = 'subject' in search && typeof search.subject === 'string' ? search.subject : undefined;
  const [selected, setSelected] = useState<string>();
  const today = [...(index.data?.days ?? []), ...(index.data?.hiddenDays ?? [])].find(
    (day) => day.key === index.data?.current,
  )?.subject;
  const subject =
    subjects.data?.find((item) => item.key === (selected ?? requested)) ??
    subjects.data?.find((item) => item.key === today) ??
    subjects.data?.[0];
  return { subjects, subject, setSelected };
}

export function ResourceForm({ scope, pdf, onDone }: { scope: ResourceScope; pdf?: ResourcePdf; onDone: () => void }) {
  const trpc = useStudyTRPC();
  const queries = useQueryClient();
  const save = useMutation(trpc.saveResource.mutationOptions());
  const [title, setTitle] = useState(pdf?.path.split('/').at(-1) ?? '');
  const [url, setUrl] = useState('');
  const [page, setPage] = useState('');
  async function submit() {
    await save.mutateAsync(
      pdf
        ? { ...scope, ...pdf, title, kind: 'pdf', pinned: true, page: page ? Number(page) : undefined }
        : { ...scope, title, kind: 'link', url },
    );
    await queries.invalidateQueries({ queryKey: trpc.resources.queryKey(scope) });
    onDone();
  }
  return (
    <div className="flex flex-col gap-md">
      <Input
        label={m.study_backlog_title()}
        value={title}
        onValueChange={setTitle}
        maxLength={200}
        disabled={save.isPending}
        required
      />
      {pdf ? (
        <Input
          label={m.study_page()}
          type="number"
          min={1}
          step={1}
          value={page}
          onValueChange={setPage}
          disabled={save.isPending}
        />
      ) : (
        <Input
          label={m.study_backlog_link()}
          type="url"
          value={url}
          onValueChange={setUrl}
          maxLength={2048}
          disabled={save.isPending}
          required
        />
      )}
      {save.isError && (
        <p role="alert">
          {m.study_save_failed()} {m.study_retry()}
        </p>
      )}
      <RegistryButton
        label={m.study_save()}
        action={submit}
        disabled={
          !title.trim() ||
          (!pdf && !url.trim()) ||
          save.isPending ||
          Boolean(page && (!Number.isInteger(Number(page)) || Number(page) < 1))
        }
      />
    </div>
  );
}

function ResourceRow({ entry, manage }: { entry: StudyResource; manage: boolean }) {
  const trpc = useStudyTRPC();
  const queries = useQueryClient();
  const draft = useResourceDraft(entry);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const pin = useMutation(trpc.setResourcePinned.mutationOptions());
  const remove = useMutation(trpc.deleteResource.mutationOptions());
  const scope = { planId: entry.planId, subjectId: entry.subjectId };
  async function refresh() {
    await queries.invalidateQueries({ queryKey: trpc.resources.queryKey(scope) });
  }
  return (
    <li aria-label={entry.title} className="flex min-w-0 flex-col gap-sm border-b border-border py-md">
      <div className="flex min-w-0 flex-wrap items-center gap-sm">
        <span className="min-w-0 flex-1 text-label break-words">{entry.title}</span>
        {entry.kind === 'note' && dirtyResourceDraft(draft) && (
          <span className="text-caption">{m.study_unsaved()}</span>
        )}
        {entry.kind === 'note' ? (
          <RegistryButton
            secondary
            label={m.study_open_material()}
            name={m.study_open_named({ label: m.study_open_material(), name: entry.title })}
            action={async () => {
              setOpen(true);
              setEditing(false);
            }}
          />
        ) : entry.kind === 'pdf' ? (
          <MaterialAction
            path={entry.path}
            folder={entry.folder ?? undefined}
            page={entry.page ?? undefined}
            name={m.study_open_named({ label: m.study_open_material(), name: entry.title })}
          />
        ) : (
          <a
            className="inline-flex min-h-touch items-center underline underline-offset-4"
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {m.study_open_material()}
          </a>
        )}
      </div>
      {manage && (
        <div className="flex flex-wrap gap-sm">
          <RegistryButton
            secondary
            label={entry.pinned ? m.study_unpin() : m.study_pin()}
            disabled={pin.isPending}
            action={async () => {
              try {
                await pin.mutateAsync({ id: entry.id, revision: entry.revision, pinned: !entry.pinned });
              } finally {
                await refresh();
              }
            }}
          />
          {entry.kind === 'pdf' && <MaterialAction path={entry.path} folder={entry.folder ?? undefined} download />}
          <RegistryButton
            ghost
            label={m.study_backlog_delete()}
            action={async () => {
              remove.reset();
              setDeleting(true);
            }}
          />
        </div>
      )}
      {pin.isError && (
        <p role="alert">
          {pin.error.data?.code === 'CONFLICT' ? m.study_conflict() : m.study_save_failed()} {m.study_retry()}
        </p>
      )}
      {entry.kind === 'note' && (
        <ResourceNote
          entry={entry}
          open={open}
          onClose={() => setOpen(false)}
          editing={editing}
          setEditing={setEditing}
        />
      )}
      <Dialog
        open={deleting}
        onOpenChange={(value) => {
          setDeleting(value);
          if (!value) remove.reset();
        }}
        title={m.study_resource_delete()}
        closeLabel={m.study_backlog_close()}
      >
        <div className="flex flex-col gap-md">
          <p>{entry.title}</p>
          <p>{m.study_resource_delete_note()}</p>
          {remove.isError && (
            <p role="alert">{remove.error.data?.code === 'CONFLICT' ? m.study_conflict() : m.study_save_failed()}</p>
          )}
          <div className="flex flex-wrap gap-sm">
            <RegistryButton
              label={m.study_backlog_delete()}
              disabled={remove.isPending}
              action={async () => {
                try {
                  await remove.mutateAsync({ id: entry.id, revision: entry.revision, confirmed: true });
                  setDeleting(false);
                } finally {
                  await refresh();
                }
              }}
            />
            <RegistryButton
              secondary
              label={m.study_error_cancel()}
              disabled={remove.isPending}
              action={async () => {
                setDeleting(false);
                remove.reset();
              }}
            />
          </div>
        </div>
      </Dialog>
    </li>
  );
}

export function ResourceList({ scope, pinned = false }: { scope: ResourceScope; pinned?: boolean }) {
  const trpc = useStudyTRPC();
  const query = useQuery(trpc.resources.queryOptions(scope));
  if (query.isPending) return <LoadingSkeleton rows={3} label={m.tile_loading()} />;
  if (query.isError)
    return (
      <div role="alert">
        <p>{m.study_error()}</p>
        <RegistryButton secondary label={m.study_retry()} action={() => query.refetch()} />
      </div>
    );
  const entries = query.data.filter((entry) => !pinned || entry.pinned);
  return entries.length ? (
    <ul>
      {entries.map((entry) => (
        <ResourceRow key={entry.id} entry={entry} manage={!pinned} />
      ))}
    </ul>
  ) : (
    <p className="text-caption text-muted-foreground">{pinned ? m.study_pins_empty() : m.study_resource_empty()}</p>
  );
}

export function StudyReferences({ selection }: { selection: ReturnType<typeof useResourceSubject> }) {
  const { subjects, subject, setSelected } = selection;
  const [create, setCreate] = useState<'note' | 'link'>();
  const [editing, setEditing] = useState(true);
  const scope = subject ? { planId: subject.planId, subjectId: subject.id } : undefined;
  const newEntry = { id: `new:${subject?.key ?? ''}`, revision: 0, title: '', body: '' };
  const newDraft = useResourceDraft(newEntry);
  return (
    <Panel title={m.study_references()}>
      {subjects.isPending ? (
        <LoadingSkeleton rows={3} label={m.tile_loading()} />
      ) : subjects.isError ? (
        <div role="alert">
          <p>{m.study_error()}</p>
          <RegistryButton label={m.study_retry()} action={() => subjects.refetch()} />
        </div>
      ) : !subject || !scope ? (
        <p>{m.study_no_plan()}</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-md">
          <Select
            label={m.study_select_status()}
            value={subject.key}
            onValueChange={(value) => {
              setSelected(value);
              setCreate(undefined);
            }}
            options={(subjects.data ?? []).map((item) => ({ value: item.key, label: item.label }))}
          />
          <div className="flex flex-wrap gap-sm">
            <RegistryButton
              label={m.study_new_note()}
              action={async () => {
                setCreate('note');
                setEditing(true);
              }}
            />
            {dirtyResourceDraft(newDraft) && <span className="self-center text-caption">{m.study_unsaved()}</span>}
            <RegistryButton secondary label={m.study_add_link()} action={async () => setCreate('link')} />
          </div>
          <ResourceList scope={scope} />
          {create === 'note' && (
            <ResourceNote
              entry={{ ...scope, ...newEntry }}
              open
              onClose={() => setCreate(undefined)}
              editing={editing}
              setEditing={setEditing}
            />
          )}
          <Dialog
            open={create === 'link'}
            onOpenChange={(value) => {
              if (!value) setCreate(undefined);
            }}
            title={m.study_add_link()}
            closeLabel={m.study_backlog_close()}
          >
            {create === 'link' && <ResourceForm scope={scope} onDone={() => setCreate(undefined)} />}
          </Dialog>
        </div>
      )}
    </Panel>
  );
}

export function PinnedResources({ scope }: { scope: ResourceScope }) {
  const trpc = useStudyTRPC();
  const resources = useQuery(trpc.resources.queryOptions(scope));
  const hasPins = resources.data?.some((entry) => entry.pinned);
  return (
    <section className="flex min-w-0 flex-col gap-md border-t border-border pt-lg">
      <h3 className="text-label">{m.study_useful_materials()}</h3>
      <ResourceList scope={scope} pinned />
      <div className="flex flex-wrap gap-sm">
        <Link
          className="inline-flex min-h-touch items-center underline underline-offset-4"
          to="/desk/$module"
          params={{ module: 'studio' }}
          search={{ tab: 'libreria', subject: `${scope.planId}:${scope.subjectId}` }}
        >
          {hasPins ? m.study_manage_materials() : m.study_add_material()}
        </Link>
      </div>
    </section>
  );
}
