import { useEffect, useReducer, useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { m } from './copy.ts';
import { useStudyTRPC } from './use-study.ts';

import { getDraft } from './today-note-draft.ts';

export function TodayNote({ dayKey, initial }: { dayKey: string; initial: string }) {
  const trpc = useStudyTRPC();
  const queries = useQueryClient();
  const save = useMutation(trpc.setNote.mutationOptions());
  const [, refresh] = useReducer((count: number) => count + 1, 0);
  const draft = getDraft(dayKey, initial);
  const sendRef = useRef<() => void>(() => {});
  function send() {
    if (draft.pending || draft.text === draft.saved) return;
    if (draft.timer) clearTimeout(draft.timer);
    const text = draft.text;
    draft.pending = true;
    draft.failed = false;
    refresh();
    void save.mutateAsync({ key: dayKey, text }).then(
      () => {
        draft.saved = text;
        draft.pending = false;
        void queries.invalidateQueries({ queryKey: trpc.progress.queryKey() });
        if (draft.text !== draft.saved) send();
        refresh();
      },
      () => {
        draft.pending = false;
        draft.failed = true;
        refresh();
      },
    );
  }
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(
    () => () => {
      if (draft.timer) clearTimeout(draft.timer);
      if (!draft.failed) sendRef.current();
    },
    [dayKey, draft],
  );
  return (
    <div className="flex flex-col gap-xs">
      <label htmlFor="study-note" className="text-title">
        {m.study_notes()}
      </label>
      <textarea
        id="study-note"
        value={draft.text}
        onChange={(event) => {
          draft.text = event.target.value;
          if (draft.timer) clearTimeout(draft.timer);
          if (!draft.failed) draft.timer = setTimeout(send, 1000);
          refresh();
        }}
        onBlur={() => {
          if (!draft.failed) send();
        }}
        className="min-h-touch rounded-md border border-border bg-surface p-md text-body"
      />
      {draft.failed ? (
        <div role="alert">
          {m.study_save_failed()}{' '}
          <button type="button" className="underline" onClick={send}>
            {m.study_retry()}
          </button>
        </div>
      ) : (
        draft.text === draft.saved && <span className="text-caption text-muted-foreground">{m.study_saved()}</span>
      )}
    </div>
  );
}
