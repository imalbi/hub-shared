import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';
import { Input } from '../../apps/web/src/components/ui/input.tsx';
import { RegistryButton } from '../../apps/web/src/components/registry-button.tsx';
import { m } from './copy.ts';
import { useStudyTRPC } from './use-study.ts';

export function StudyMix({
  subjects,
  mix,
  hours,
  suggested,
  states,
}: {
  subjects: { id: string; name: string }[];
  mix: Record<string, number> | null;
  hours: number | null;
  suggested?: Record<string, number>;
  states: Record<string, string>;
}) {
  const trpc = useStudyTRPC();
  const queries = useQueryClient();
  const save = useMutation(trpc.setMix.mutationOptions({ onSuccess: () => queries.invalidateQueries() }));
  const activeSubjects = subjects.filter(
    (subject) => states[subject.id] !== 'paused' && states[subject.id] !== 'passed',
  );
  function suggestion() {
    const shares: Array<[string, number]> = subjects.map((subject) => [
      subject.id,
      activeSubjects.includes(subject) ? (suggested?.[subject.id] ?? 0) : 0,
    ]);
    const total = shares.reduce((sum, [, value]) => sum + value, 0);
    return Object.fromEntries(shares.map(([id, value]) => [id, total ? (value * 100) / total : 0]));
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const shares = Object.fromEntries(
      subjects.map((subject) => [
        subject.id,
        states[subject.id] === 'paused' || states[subject.id] === 'passed' ? 0 : Number(data.get(subject.id)),
      ]),
    );
    save.mutate({ hours: Number(data.get('hours')), mix: shares });
  }
  return (
    <form onSubmit={submit} className="flex flex-col gap-md border-t border-dashed border-border pt-lg">
      <h3 className="text-title">{m.study_mix()}</h3>
      <div className="grid grid-cols-2 gap-md">
        <Input
          label={m.study_hours()}
          type="number"
          name="hours"
          min="0.1"
          max="168"
          step="0.1"
          defaultValue={hours ?? 1}
          required
        />
        {activeSubjects.map((subject, index) => (
          <Input
            key={subject.id}
            label={`${subject.name} · ${m.study_share()} %`}
            type="number"
            name={subject.id}
            min="0"
            max="100"
            step="1"
            defaultValue={
              mix?.[subject.id] ??
              Math.floor(100 / activeSubjects.length) + (index < 100 % activeSubjects.length ? 1 : 0)
            }
            required
          />
        ))}
      </div>
      {save.isError && <p role="alert">{m.study_error()}</p>}
      <div className="flex flex-wrap items-center gap-sm">
        <button
          type="submit"
          className="h-touch cursor-pointer rounded-full bg-primary px-lg text-label text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          {m.study_save()}
        </button>
        {suggested && (
          <RegistryButton
            secondary
            label={m.study_apply_mix()}
            action={() => save.mutateAsync({ hours: hours ?? 1, mix: suggestion() })}
          />
        )}
      </div>
    </form>
  );
}
