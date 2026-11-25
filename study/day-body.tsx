import { FilePdfIcon, WarningCircleIcon } from '@phosphor-icons/react';
import { causeLabel } from './error-form.tsx';
import { MaterialAction } from './material.tsx';
import { Badge } from '../../apps/web/src/components/ui/badge.tsx';
import { Checkbox } from '../../apps/web/src/components/ui/checkbox.tsx';
import { Tooltip } from '../../apps/web/src/components/ui/tooltip.tsx';
import { m } from './copy.ts';
import type { StudyDay, StudyDayBody as Body, StudyError, StudyHeader } from './use-study.ts';

type StepFileData = NonNullable<Body['blocks'][number]['steps'][number]['file']>;

const fileName = (path: string) => path.split('/').at(-1) ?? path;

/** The day's materials first, then each step file once; the first page seen for a path wins. */
function filesToOpen(body: Body) {
  const seen = new Set<string>();
  return [
    ...(body.materials ?? []),
    ...body.blocks.flatMap((block) =>
      block.steps.flatMap((step) => (step.file ? [{ ...step.file, label: undefined }] : [])),
    ),
  ].filter((file) => !seen.has(file.path) && !!seen.add(file.path));
}

export function DayBody({
  body,
  header,
  titles,
  checked,
  onStep,
  notes,
  errors,
  onError,
  instrument = false,
}: {
  body: Body;
  header: StudyHeader;
  titles: Map<string, StudyDay>;
  checked?: Set<string>;
  onStep?: (id: string, done: boolean) => void;
  notes?: Map<string, string>;
  /** Error log entries: the recalled days show theirs. */
  errors?: StudyError[];
  /** Starts an error entry on a step (Oggi only). */
  onError?: (step: Body['blocks'][number]['steps'][number]) => void;
  instrument?: boolean;
}) {
  const files = filesToOpen(body);
  const allSteps = body.blocks.flatMap((block) => block.steps);
  const current = allSteps.find((step) => !checked?.has(step.id))?.id;
  const threads = header.threads.filter((thread) => body.threads.includes(thread.id));
  return (
    <div className="flex flex-col gap-md">
      {(threads.length > 0 || body.recall.length > 0) && (
        <div className="flex flex-wrap items-center gap-sm">
          {threads.map((thread) => (
            <Badge key={thread.id} outline>
              {thread.title}
            </Badge>
          ))}
          {body.recall.map((id) => {
            const recalled = titles.get(`${header.id}/${id}`);
            return (
              <span key={id} className="text-caption text-muted-foreground">
                {m.study_recall()}:{' '}
                {recalled ? `${recalled.g === null ? '' : `G${recalled.g} · `}${recalled.title}` : id}
                {notes?.get(id) && <span className="block">{notes.get(id)}</span>}
                {errors
                  ?.filter((entry) => entry.key === `${header.id}/${id}`)
                  .map((entry) => (
                    <span key={entry.id} className="block">
                      {m.study_errors()}: {entry.reference} · {causeLabel(entry.cause)}
                      {entry.method && ` · ${entry.method}`}
                    </span>
                  ))}
              </span>
            );
          })}
        </div>
      )}
      {files.length > 0 && (
        <fieldset aria-label={m.study_to_open()} className="flex min-w-0 flex-wrap items-center gap-sm">
          <span aria-hidden="true" className="text-caption text-muted-foreground uppercase">
            {m.study_to_open()}
          </span>
          {files.map((file) => (
            <MaterialAction
              key={file.path}
              path={file.path}
              page={file.page}
              label={file.label ?? fileName(file.path).replace(/\.pdf$/i, '')}
              icon={<FilePdfIcon aria-hidden="true" className="size-icon-sm" />}
            />
          ))}
        </fieldset>
      )}
      <div className="flex flex-col gap-md">
        {body.blocks.map((block) => (
          <section
            key={block.id}
            className="flex min-w-0 flex-col gap-xs border-t border-dashed border-border pt-md first:border-t-0 first:pt-0"
          >
            <h4
              className={
                instrument ? 'text-caps text-muted-foreground' : 'text-caption text-muted-foreground uppercase'
              }
            >
              {block.title}
            </h4>
            <ul className="flex flex-col gap-sm">
              {block.steps.map((step) => (
                <li
                  key={step.id}
                  data-current={(instrument && current === step.id) || undefined}
                  className={
                    instrument
                      ? 'study-step group flex items-center gap-sm text-body'
                      : 'flex items-center gap-sm text-body'
                  }
                >
                  {instrument && (
                    <span className="text-figure text-muted-foreground">
                      {String(allSteps.findIndex((item) => item.id === step.id) + 1).padStart(2, '0')}
                    </span>
                  )}
                  {onStep ? (
                    <Checkbox
                      aria-label={step.text}
                      checked={checked?.has(step.id) ?? false}
                      onCheckedChange={(done) => onStep(step.id, done)}
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="mt-2xs size-icon-sm shrink-0 rounded-full border border-border"
                    />
                  )}
                  <span className="min-w-0 flex-1">{step.text}</span>
                  {(step.minutes || step.file || onError) && (
                    <div className="flex shrink-0 items-center gap-sm">
                      {step.file && <StepFile file={step.file} />}
                      {step.minutes && (
                        <span className="text-caption text-muted-foreground tabular-nums">
                          {m.study_minutes({ minutes: step.minutes })}
                        </span>
                      )}
                      {onError && (
                        <Tooltip content={m.study_error_add()}>
                          <button
                            type="button"
                            // The visible "Errore" alone would not say which step it is about.
                            aria-label={m.study_error_step({ step: step.text })}
                            onClick={() => onError(step)}
                            className={
                              instrument
                                ? 'study-error cursor-pointer rounded-full border border-border px-sm text-label focus-visible:opacity-100'
                                : 'flex size-icon shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none'
                            }
                          >
                            {instrument ? (
                              m.study_error_short()
                            ) : (
                              <WarningCircleIcon aria-hidden="true" className="size-icon-sm" />
                            )}
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p className="text-body">
        <span className="text-caption text-muted-foreground uppercase">{m.study_check()}</span> {body.check}
      </p>
    </div>
  );
}

/** One compact link: "Apri p. 34", named after the file for assistive tech. */
export function StepFile({ file }: { file: StepFileData }) {
  const label = file.page ? m.study_open_page({ page: file.page }) : m.study_open_material();
  return (
    <MaterialAction
      path={file.path}
      page={file.page}
      label={label}
      name={m.study_open_named({ label, name: fileName(file.path) })}
    />
  );
}
