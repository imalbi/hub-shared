import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RegistryButton } from '../../apps/web/src/components/registry-button.tsx';
import { Input } from '../../apps/web/src/components/ui/input.tsx';
import { Select } from '../../apps/web/src/components/ui/select.tsx';
import { Textarea } from '../../apps/web/src/components/ui/textarea.tsx';
import { m } from './copy.ts';
import { useStudyTRPC, type StudyDay, type StudyError } from './use-study.ts';

const labels = {
  concept: m.study_cause_concept,
  model: m.study_cause_model,
  step: m.study_cause_step,
  calculation: m.study_cause_calculation,
  unit: m.study_cause_unit,
  reading: m.study_cause_reading,
  memory: m.study_cause_memory,
  time: m.study_cause_time,
};
type Cause = keyof typeof labels;
const isCause = (value: string): value is Cause => value in labels;
export const causeLabel = (cause: Cause) => labels[cause]();
export const causeOrder = Object.keys(labels);

const resultLabels = { solved: m.study_error_result_solved, again: m.study_error_result_again };
type Result = keyof typeof resultLabels;
const isResult = (value: string): value is Result => value in resultLabels;

/** The short error-log form (decision 8): only the reference and the cause are required. */
export function ErrorForm({
  dayKey,
  entry,
  reference = '',
  retryDays,
  onDone,
}: {
  dayKey: string;
  entry?: StudyError;
  /** Prefilled from the step the entry was started on. */
  reference?: string;
  /** Open days offered as the day to retry on. */
  retryDays: StudyDay[];
  onDone: () => void;
}) {
  const trpc = useStudyTRPC();
  const queries = useQueryClient();
  const save = useMutation(trpc.setError.mutationOptions());
  const [text, setText] = useState(entry?.reference ?? reference);
  const [tried, setTried] = useState(entry?.tried ?? '');
  const [cause, setCause] = useState<Cause | null>(entry?.cause ?? null);
  const [method, setMethod] = useState(entry?.method ?? '');
  const [retry, setRetry] = useState(entry?.retry ?? '');
  const [result, setResult] = useState<Result | ''>(entry?.result ?? '');
  return (
    <form
      aria-label={m.study_error_add()}
      className="flex flex-col gap-md border-t border-dashed border-border pt-md"
      onSubmit={(event) => event.preventDefault()}
    >
      <Input
        label={m.study_error_reference()}
        hint={m.study_error_reference_hint()}
        value={text}
        onValueChange={setText}
        maxLength={500}
      />
      <Textarea label={m.study_error_tried()} minRows={2} value={tried} onValueChange={setTried} maxLength={5000} />
      <div className="grid grid-cols-2 gap-md">
        <Select
          label={m.study_error_cause()}
          placeholder={m.study_error_cause_pick()}
          value={cause}
          onValueChange={(value) => isCause(value) && setCause(value)}
          options={causeOrder.map((value) => ({ value, label: isCause(value) ? causeLabel(value) : value }))}
        />
        <Select
          label={m.study_error_retry()}
          value={retry}
          onValueChange={setRetry}
          options={[
            { value: '', label: m.study_error_retry_none() },
            ...retryDays.map((day) => ({ value: day.key, label: `G${day.g} · ${day.title}` })),
          ]}
        />
      </div>
      <Textarea label={m.study_error_method()} minRows={2} value={method} onValueChange={setMethod} maxLength={5000} />
      <Select
        label={m.study_error_result()}
        value={result}
        onValueChange={(value) => setResult(value === '' ? '' : isResult(value) ? value : '')}
        options={[
          { value: '', label: m.study_error_result_open() },
          ...Object.entries(resultLabels).map(([value, label]) => ({ value, label: label() })),
        ]}
      />
      <div className="flex flex-wrap items-center gap-sm">
        <RegistryButton
          label={m.study_error_save()}
          disabled={!text.trim() || !cause}
          action={async () => {
            if (!cause) return;
            await save.mutateAsync({
              id: entry?.id,
              key: dayKey,
              reference: text,
              tried,
              cause,
              method,
              retry: retry || null,
              result: result || null,
            });
            await queries.invalidateQueries();
            onDone();
          }}
        />
        <RegistryButton secondary label={m.study_error_cancel()} action={async () => onDone()} />
      </div>
    </form>
  );
}
