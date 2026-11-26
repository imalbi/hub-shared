import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Panel } from '../../apps/web/src/components/panel.tsx';
import { RegistryButton } from '../../apps/web/src/components/registry-button.tsx';
import { Dialog } from '../../apps/web/src/components/ui/dialog.tsx';
import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import { Input } from '../../apps/web/src/components/ui/input.tsx';
import { LoadingSkeleton } from '../../apps/web/src/components/ui/loading-skeleton.tsx';
import { PillSelect } from '../../apps/web/src/components/ui/pill-select.tsx';
import { Select } from '../../apps/web/src/components/ui/select.tsx';
import { Textarea } from '../../apps/web/src/components/ui/textarea.tsx';
import { m } from './copy.ts';
import { useStudyTRPC, type StudyBacklogEntry } from './use-study.ts';

const statuses = [
  { value: 'todo', label: m.study_backlog_todo() },
  { value: 'active', label: m.study_backlog_active() },
  { value: 'completed', label: m.study_backlog_completed() },
];
const isStatus = (value: string): value is StudyBacklogEntry['status'] =>
  value === 'todo' || value === 'active' || value === 'completed';

function BacklogForm({ entry, onDone }: { entry?: StudyBacklogEntry; onDone: () => void }) {
  const trpc = useStudyTRPC();
  const queries = useQueryClient();
  const save = useMutation(trpc.saveBacklog.mutationOptions());
  const [title, setTitle] = useState(entry?.title ?? '');
  const [note, setNote] = useState(entry?.note ?? '');
  const [url, setUrl] = useState(entry?.url ?? '');
  const [status, setStatus] = useState<StudyBacklogEntry['status']>(entry?.status ?? 'todo');
  async function submit() {
    await save.mutateAsync({ id: entry?.id, title, note, url, status });
    await queries.invalidateQueries({ queryKey: trpc.backlog.queryKey() });
    onDone();
  }
  return (
    <form
      aria-label={entry ? m.study_backlog_edit() : m.study_backlog_add()}
      className="flex max-w-dialog-lg flex-col gap-md"
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim() && !save.isPending)
          save.mutate(
            { id: entry?.id, title, note, url, status },
            {
              onSuccess: () => {
                void queries.invalidateQueries({ queryKey: trpc.backlog.queryKey() });
                onDone();
              },
            },
          );
      }}
    >
      <Input
        label={m.study_backlog_title()}
        value={title}
        onValueChange={setTitle}
        maxLength={200}
        disabled={save.isPending}
        required
      />
      <Textarea
        label={m.study_backlog_note()}
        value={note}
        onValueChange={setNote}
        minRows={2}
        maxLength={1000}
        disabled={save.isPending}
      />
      <Input
        label={m.study_backlog_link()}
        type="url"
        value={url}
        onValueChange={setUrl}
        maxLength={2048}
        disabled={save.isPending}
      />
      <Select
        label={m.study_backlog_status()}
        value={status}
        disabled={save.isPending}
        options={statuses}
        onValueChange={(value) => {
          if (isStatus(value)) setStatus(value);
        }}
      />
      {save.isError && (
        <p role="alert">
          {m.study_save_failed()}. {m.study_retry()}.
        </p>
      )}
      <div className="flex flex-wrap gap-sm">
        <RegistryButton label={m.study_save()} disabled={!title.trim() || save.isPending} action={submit} />
        <RegistryButton
          secondary
          label={m.study_error_cancel()}
          disabled={save.isPending}
          action={async () => onDone()}
        />
      </div>
    </form>
  );
}

function BacklogRow({ entry }: { entry: StudyBacklogEntry }) {
  const trpc = useStudyTRPC();
  const queries = useQueryClient();
  const change = useMutation(trpc.setBacklogStatus.mutationOptions());
  const remove = useMutation(trpc.deleteBacklog.mutationOptions());
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const refresh = () => queries.invalidateQueries({ queryKey: trpc.backlog.queryKey() });
  return (
    <li aria-label={entry.title} className="flex flex-col gap-md border-b border-border py-md">
      <div className="flex flex-wrap items-center justify-between gap-md">
        <div className="min-w-0 flex-1 break-words">
          <h3 className="font-medium">{entry.title}</h3>
          {entry.note && <p className="whitespace-pre-wrap text-muted-foreground">{entry.note}</p>}
          {entry.url && (
            <a className="underline underline-offset-4" href={entry.url} target="_blank" rel="noopener noreferrer">
              {m.study_backlog_link()}
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-sm">
          <PillSelect
            label={m.study_backlog_status()}
            size="md"
            value={entry.status}
            options={statuses}
            disabled={change.isPending || editing}
            onValueChange={(status) => {
              if (isStatus(status)) change.mutate({ id: entry.id, status }, { onSuccess: () => void refresh() });
            }}
          />
          <RegistryButton
            secondary
            label={m.study_backlog_edit()}
            disabled={editing}
            action={async () => setEditing(true)}
          />
          <RegistryButton secondary label={m.study_backlog_delete()} action={async () => setConfirming(true)} />
        </div>
      </div>
      {change.isError && (
        <p role="alert">
          {m.study_save_failed()}. {m.study_retry()}.
        </p>
      )}
      {editing && <BacklogForm entry={entry} onDone={() => setEditing(false)} />}
      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          setConfirming(open);
          if (!open) remove.reset();
        }}
        title={m.study_backlog_delete_title()}
        description={m.study_backlog_delete_note()}
        closeLabel={m.study_backlog_close()}
        size="sm"
      >
        <p className="break-words">{entry.title}</p>
        {remove.isError && (
          <p role="alert">
            {m.study_error()}. {m.study_retry()}.
          </p>
        )}
        <div className="mt-md flex flex-wrap gap-sm">
          <RegistryButton
            secondary
            label={m.study_error_cancel()}
            disabled={remove.isPending}
            action={async () => {
              setConfirming(false);
              remove.reset();
            }}
          />
          <RegistryButton
            label={m.study_backlog_delete()}
            disabled={remove.isPending}
            action={async () => {
              await remove.mutateAsync({ id: entry.id, confirmed: true });
              setConfirming(false);
              await refresh();
            }}
          />
        </div>
      </Dialog>
    </li>
  );
}

export function StudyBacklog() {
  const trpc = useStudyTRPC();
  const backlog = useQuery(trpc.backlog.queryOptions());
  const [adding, setAdding] = useState(false);
  const items = backlog.data ?? [];
  return (
    <Panel title={m.study_backlog()}>
      <RegistryButton
        className="self-start"
        label={m.study_backlog_add()}
        disabled={adding}
        action={async () => setAdding(true)}
      />
      {adding && <BacklogForm onDone={() => setAdding(false)} />}
      {backlog.isError && (
        <div role="alert">
          <p>{m.study_error()}</p>
          <RegistryButton secondary label={m.study_retry()} action={() => backlog.refetch()} />
        </div>
      )}
      {backlog.isPending ? (
        <LoadingSkeleton label={m.tile_loading()} rows={3} />
      ) : !backlog.isError && items.length === 0 ? (
        <EmptyState scene="inbox" title={m.study_backlog_empty()} />
      ) : (
        [false, true].map((completed) => {
          const rows = items.filter((item) => (item.status === 'completed') === completed);
          return (
            rows.length > 0 && (
              <section key={String(completed)} aria-label={completed ? m.study_backlog_done() : m.study_backlog_open()}>
                <h2 className="text-muted-foreground">{completed ? m.study_backlog_done() : m.study_backlog_open()}</h2>
                <ul>
                  {rows.map((entry) => (
                    <BacklogRow key={entry.id} entry={entry} />
                  ))}
                </ul>
              </section>
            )
          );
        })
      )}
    </Panel>
  );
}
