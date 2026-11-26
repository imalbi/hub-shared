import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createTRPCOptionsProxy, type ofFeatureFlags } from '@trpc/tanstack-react-query';
import type { AnyRouter, inferRouterOutputs } from '../../apps/web/src/lib/module-client.ts';
import { useState } from 'react';
import type { studyModule } from './server.ts';
import { createModuleClient } from '../../apps/web/src/lib/module-client.ts';

type StudyRouter = Extract<ReturnType<typeof studyModule.create>['router'], AnyRouter>;
export type StudyIndex = NonNullable<inferRouterOutputs<StudyRouter>['index']>;
export type StudyHeader = inferRouterOutputs<StudyRouter>['active'][number];
export type StudyDayBody = inferRouterOutputs<StudyRouter>['daysById'][number];
export type StudyProgressRow = inferRouterOutputs<StudyRouter>['progress'][number];
export type StudyError = inferRouterOutputs<StudyRouter>['errors'][number];
export type StudyResource = inferRouterOutputs<StudyRouter>['resources'][number];
export type StudyBacklogEntry = inferRouterOutputs<StudyRouter>['backlog'][number];
export type StudyReview = inferRouterOutputs<StudyRouter>['review'];
export type StudyDay = StudyIndex['days'][number] | StudyIndex['hiddenDays'][number];
export const studyClient = createModuleClient<typeof studyModule>('study');

/** Every subject of the active plans, keyed `<planId>:<subjectId>` like the server's index (decision 15). */
export type StudySubject = { key: string; planId: string; id: string; name: string; label: string };
export function studySubjects(headers: StudyHeader[]): StudySubject[] {
  return headers.flatMap((header) =>
    header.subjects.map((subject) => ({
      key: `${header.id}:${subject.id}`,
      planId: header.id,
      id: subject.id,
      name: subject.name,
      // One plan: the subject's name. Several: the plan names its course, plus the subject when it has more than one.
      label:
        headers.length === 1
          ? subject.name
          : header.subjects.length === 1
            ? header.title
            : `${header.title} · ${subject.name}`,
    })),
  );
}

/** Subject shades for the day strip and the row marks, by subject position: greys only (AGENTS.md aesthetic). */
const shades = ['bg-foreground/30', 'bg-foreground/10', 'bg-foreground/50', 'bg-foreground/20'];
export function subjectShade(subjects: StudySubject[], key: string) {
  return shades[
    Math.max(
      0,
      subjects.findIndex((item) => item.key === key),
    ) % shades.length
  ];
}

export function useStudyTRPC() {
  const queryClient = useQueryClient();
  return createTRPCOptionsProxy<StudyRouter, ofFeatureFlags<{ keyPrefix: true }>>({
    client: studyClient,
    queryClient,
    keyPrefix: 'study',
  });
}

type StepDraft = { values: Record<string, boolean>; failed: Record<string, boolean>; pending: Set<string> };
const stepDrafts = new Map<string, StepDraft>();
function getStepDraft(key: string) {
  const value = stepDrafts.get(key) ?? { values: {}, failed: {}, pending: new Set<string>() };
  stepDrafts.set(key, value);
  return value;
}
function startStep(draft: StepDraft, id: string, done: boolean) {
  draft.pending.add(id);
  draft.values = { ...draft.values, [id]: done };
}
function failStep(draft: StepDraft, id: string, done: boolean) {
  draft.failed = { ...draft.failed, [id]: done };
}
function clearFailedStep(draft: StepDraft, id: string) {
  const next = { ...draft.failed };
  delete next[id];
  draft.failed = next;
}
function clearStep(draft: StepDraft, id: string, done: boolean) {
  if (draft.values[id] === done) {
    const next = { ...draft.values };
    delete next[id];
    draft.values = next;
  }
}

export function useCurrentStudyDay() {
  const trpc = useStudyTRPC();
  const headers = useQuery(trpc.active.queryOptions());
  const index = useQuery(trpc.index.queryOptions());
  const progress = useQuery(trpc.progress.queryOptions());
  const key = index.data?.current;
  const body = useQuery(trpc.daysById.queryOptions({ keys: key ? [key] : [] }, { enabled: !!key }));
  const isError = headers.isError || index.isError || progress.isError || body.isError;
  const isPending = headers.isPending || index.isPending || progress.isPending || Boolean(key && body.isPending);
  const day = body.data?.[0];
  const header = headers.data?.find((item) => item.id === day?.planId);
  const current = index.data?.days.find((item) => item.key === day?.key);
  const subjects = headers.data ? studySubjects(headers.data) : [];
  const subjectInfo = subjects.find((item) => item.key === current?.subject);
  return {
    isPending,
    isError,
    headers: headers.data,
    index: index.data,
    records: progress.data,
    day,
    header,
    current,
    subjects,
    subjectInfo,
  };
}

export function useStudySteps(day: StudyDayBody, records: StudyProgressRow[]) {
  const trpc = useStudyTRPC();
  const queries = useQueryClient();
  const draft = getStepDraft(day.key);
  const [, refresh] = useState(0);
  const step = useMutation(trpc.setStep.mutationOptions());
  const own = records.filter((item) => item.planId === day.planId);
  const allSteps = day.blocks.flatMap((block) => block.steps);
  const checked = new Set(
    allSteps
      .filter(
        (item) =>
          draft.values[item.id] ?? own.some((row) => row.kind === 'step' && row.id === item.id && row.value === 'done'),
      )
      .map((item) => item.id),
  );
  return {
    allSteps,
    checked,
    failed: draft.failed,
    saveStep: (id: string, done: boolean) => {
      if (draft.pending.has(id)) return;
      startStep(draft, id, done);
      refresh((value) => value + 1);
      void step
        .mutateAsync({ key: day.key, id, done })
        .then(
          async () => {
            clearFailedStep(draft, id);
            await queries.invalidateQueries();
            clearStep(draft, id, done);
          },
          () => {
            failStep(draft, id, done);
          },
        )
        .finally(() => {
          draft.pending.delete(id);
          refresh((value) => value + 1);
        });
    },
  };
}
