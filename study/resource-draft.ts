type Note = { title: string; body: string; revision: number };
export type ResourceDraft = { title: string; body: string; saved: Note; server: Note };
export const dirtyResourceDraft = (draft: ResourceDraft) =>
  draft.title !== draft.saved.title || draft.body !== draft.saved.body;

export function observeResourceDraft(draft: ResourceDraft | undefined, note: Note): ResourceDraft {
  if (!draft) return { title: note.title, body: note.body, saved: note, server: note };
  if (note.revision <= draft.server.revision) return draft;
  return dirtyResourceDraft(draft)
    ? { ...draft, server: note }
    : { title: note.title, body: note.body, saved: note, server: note };
}

export function savedResourceDraft(note: Note): ResourceDraft {
  return { title: note.title, body: note.body, saved: note, server: note };
}
