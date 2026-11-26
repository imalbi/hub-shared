import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Dialog } from '../../apps/web/src/components/ui/dialog.tsx';
import { Input } from '../../apps/web/src/components/ui/input.tsx';
import { Textarea } from '../../apps/web/src/components/ui/textarea.tsx';
import { RegistryButton } from '../../apps/web/src/components/registry-button.tsx';
import { m } from './copy.ts';
import { dirtyResourceDraft, observeResourceDraft, savedResourceDraft, type ResourceDraft } from './resource-draft.ts';
import { useStudyTRPC, type StudyResource } from './use-study.ts';

const drafts = new Map<string, ResourceDraft>();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function updateDraft(id: string, draft: ResourceDraft) {
  drafts.set(id, draft);
  for (const listener of listeners) listener();
}
export function useResourceDraft(entry: Pick<StudyResource, 'id' | 'title' | 'body' | 'revision'>) {
  const stored = useSyncExternalStore(subscribe, () => drafts.get(entry.id));
  useEffect(() => {
    const previous = drafts.get(entry.id);
    const next = observeResourceDraft(previous, entry);
    if (next !== previous) updateDraft(entry.id, next);
  }, [entry]);
  return stored ?? savedResourceDraft(entry);
}

export function safeReferenceUrl(value: string) {
  return URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol) ? value : '';
}

function ReferenceLink({ href, children }: { href?: string; children?: ReactNode }) {
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}
const markdownComponents = { a: ReferenceLink };

export function ResourceNote({
  entry,
  open,
  onClose,
  editing,
  setEditing,
}: {
  entry: Pick<StudyResource, 'id' | 'title' | 'body' | 'revision' | 'planId' | 'subjectId'>;
  open: boolean;
  onClose: () => void;
  editing: boolean;
  setEditing: (value: boolean) => void;
}) {
  const draft = useResourceDraft(entry);
  const trpc = useStudyTRPC();
  const queries = useQueryClient();
  const scope = { planId: entry.planId, subjectId: entry.subjectId };
  const save = useMutation(trpc.saveResource.mutationOptions());
  const dirty = dirtyResourceDraft(draft);
  const conflict = save.error?.data?.code === 'CONFLICT';
  async function latest() {
    const rows = await queries.fetchQuery(trpc.resources.queryOptions(scope, { staleTime: 0 }));
    const row = rows.find((item) => item.id === entry.id);
    if (!row) throw new Error(m.study_material_unavailable());
    return row;
  }
  async function persist(overwrite = false) {
    const revision = overwrite ? (await latest()).revision : draft.saved.revision;
    const result = await save.mutateAsync({
      ...scope,
      ...(entry.revision ? { id: entry.id, revision } : { id: undefined, revision: undefined }),
      kind: 'note',
      title: draft.title,
      body: draft.body,
    });
    updateDraft(entry.id, savedResourceDraft(entry.revision ? result : { title: '', body: '', revision: 0 }));
    await queries.invalidateQueries({ queryKey: trpc.resources.queryKey(scope) });
    setEditing(false);
    if (!entry.revision) onClose();
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          if (save.isSuccess) save.reset();
          onClose();
        }
      }}
      title={entry.revision ? entry.title : m.study_new_note()}
      closeLabel={m.study_backlog_close()}
      size="lg"
    >
      <div className="flex min-w-0 flex-col gap-md">
        {editing ? (
          <>
            <Input
              label={m.study_backlog_title()}
              value={draft.title}
              onValueChange={(title) => updateDraft(entry.id, { ...draft, title })}
              maxLength={200}
              disabled={save.isPending}
              required
            />
            <Textarea
              label={m.study_text()}
              value={draft.body}
              onValueChange={(body) => updateDraft(entry.id, { ...draft, body })}
              maxLength={100000}
              minRows={12}
              disabled={save.isPending}
            />
          </>
        ) : (
          <article className="study-markdown min-w-0 break-words">
            <Markdown
              remarkPlugins={[remarkGfm]}
              skipHtml
              urlTransform={safeReferenceUrl}
              disallowedElements={['img', 'input']}
              components={markdownComponents}
            >
              {draft.body}
            </Markdown>
          </article>
        )}
        {dirty && <output>{m.study_unsaved()}</output>}
        {save.isSuccess && !dirty && <output>{m.study_saved()}</output>}
        {save.isError && (
          <div role="alert" className="flex flex-col gap-sm">
            <p>{conflict ? m.study_conflict() : m.study_save_failed()}</p>
            {conflict && (
              <div className="flex flex-wrap gap-sm">
                <RegistryButton
                  secondary
                  label={m.study_reload_server()}
                  disabled={save.isPending}
                  action={async () => {
                    updateDraft(entry.id, savedResourceDraft(await latest()));
                    save.reset();
                  }}
                />
                <RegistryButton label={m.study_overwrite()} disabled={save.isPending} action={() => persist(true)} />
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-sm">
          {editing ? (
            <RegistryButton
              label={save.isError && !conflict ? m.study_retry() : m.study_save()}
              disabled={!draft.title.trim() || save.isPending || conflict}
              action={() => persist()}
            />
          ) : (
            <RegistryButton secondary label={m.study_backlog_edit()} action={async () => setEditing(true)} />
          )}
          {dirty && (
            <RegistryButton
              secondary
              label={m.study_discard()}
              disabled={save.isPending}
              action={async () => {
                updateDraft(entry.id, savedResourceDraft(draft.server));
                save.reset();
              }}
            />
          )}
        </div>
      </div>
    </Dialog>
  );
}
