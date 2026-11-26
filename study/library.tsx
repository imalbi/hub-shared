import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import { RegistryButton } from '../../apps/web/src/components/registry-button.tsx';
import { Dialog } from '../../apps/web/src/components/ui/dialog.tsx';
import { ResourceForm, StudyReferences, useResourceSubject, type ResourcePdf } from './resources.tsx';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Panel } from '../../apps/web/src/components/panel.tsx';
import { Input } from '../../apps/web/src/components/ui/input.tsx';
import { Select } from '../../apps/web/src/components/ui/select.tsx';
import { m } from './copy.ts';
import { MaterialAction } from './material.tsx';
import { useStudyTRPC } from './use-study.ts';

export function StudyLibrary() {
  const trpc = useStudyTRPC();
  const library = useQuery(trpc.library.queryOptions());
  const selection = useResourceSubject();
  const [pinning, setPinning] = useState<ResourcePdf>();
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState('');

  const items = library.data ?? [];
  const folders = [...new Map(items.map((item) => [item.folder, item.folderName])).entries()];
  const visible = items.filter(
    (item) =>
      (!folder || String(item.folder) === folder) && item.path.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <div className="grid min-w-0 grid-cols-1 gap-xl lg:grid-cols-2">
      <StudyReferences selection={selection} />
      <Panel title={m.study_library()}>
        <div className="flex flex-wrap items-end gap-md">
          <div className="min-w-0 flex-1">
            <Input label={m.study_search_material()} value={search} onValueChange={setSearch} />
          </div>
          <div>
            <Select
              label={m.study_material_folder()}
              value={folder}
              onValueChange={setFolder}
              options={[
                { value: '', label: m.study_all() },
                ...folders.map(([id, name]) => ({ value: String(id), label: name })),
              ]}
            />
          </div>
        </div>
        {library.isError ? (
          <div role="alert">
            <p>{m.study_error()}</p>
            <RegistryButton secondary label={m.study_retry()} action={() => library.refetch()} />
          </div>
        ) : library.isPending ? (
          <output aria-label={m.tile_loading()}>
            <ul aria-hidden="true">
              {[0, 1, 2].map((row) => (
                <li key={row} className="flex items-center justify-between gap-md border-b border-border py-sm">
                  <span className="h-md w-3xl rounded-sm bg-muted-foreground/20 motion-safe:animate-pulse" />
                  <span className="h-touch w-2xl rounded-full bg-muted-foreground/20 motion-safe:animate-pulse" />
                </li>
              ))}
            </ul>
          </output>
        ) : visible.length === 0 ? (
          <EmptyState scene={search || folder ? 'search' : 'inbox'} title={m.study_empty()} />
        ) : (
          <ul>
            {visible.map((item) => (
              <li
                key={`${item.folder}/${item.path}`}
                className="flex flex-wrap items-center justify-between gap-md border-b border-border py-sm"
              >
                <span>
                  {item.path} · {item.folderName}
                </span>
                <span className="flex gap-sm">
                  <MaterialAction path={item.path} folder={item.folder} />
                  <MaterialAction path={item.path} folder={item.folder} download />
                  {selection.subject && (
                    <RegistryButton secondary label={m.study_pin()} action={async () => setPinning(item)} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Dialog
        open={Boolean(pinning)}
        onOpenChange={(value) => {
          if (!value) setPinning(undefined);
        }}
        title={m.study_pin()}
        closeLabel={m.study_backlog_close()}
      >
        {pinning && selection.subject && (
          <ResourceForm
            scope={{ planId: selection.subject.planId, subjectId: selection.subject.id }}
            pdf={pinning}
            onDone={() => setPinning(undefined)}
          />
        )}
      </Dialog>
    </div>
  );
}
