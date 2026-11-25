type Draft = {
  text: string;
  saved: string;
  server: string;
  pending: boolean;
  failed: boolean;
  timer?: ReturnType<typeof setTimeout>;
};
const drafts = new Map<string, Draft>();
export function getDraft(key: string, initial: string): Draft {
  const draft = drafts.get(key) ?? { text: initial, saved: initial, server: initial, pending: false, failed: false };
  if (initial !== draft.server) {
    if (!draft.pending && !draft.failed && draft.text === draft.saved) {
      draft.text = initial;
      draft.saved = initial;
    }
    draft.server = initial;
  }
  drafts.set(key, draft);
  return draft;
}
