import { Gaps } from './ui-notes.tsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as React from 'react';
import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import { NumberRoll } from '../../apps/web/src/components/ui/number-roll.tsx';
import { ActionButton } from '../../apps/web/src/components/ui/action-button.tsx';
import { createModuleClient } from '../../apps/web/src/lib/module-client.ts';
import { useNow } from '../../apps/web/src/lib/use-now.ts';
import { Panel } from '../../apps/web/src/components/panel.tsx';
import { copy } from './copy.ts';
import type definition from './server.ts';
import type { JobRow } from './server.ts';
import { applicationStats, displayName, type Outcomes } from './stats.ts';
import { useFirstResponse } from './ui-mail-data.ts';

const outcomeKeys = ['replied', 'interviews', 'offers', 'rejections', 'ghosted'] as const;

const percent = (part: number, sent: number) => (sent === 0 ? null : Math.round((part / sent) * 100));

function Table({
  caption,
  first,
  heads,
  rows,
}: {
  caption: string;
  first: string;
  heads: string[];
  rows: { label: string; cells: number[] }[];
}) {
  return (
    <table className="w-full text-label">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="text-caption text-muted-foreground">
          <th scope="col" className="py-xs text-left font-normal">
            {first}
          </th>
          {heads.map((head) => (
            <th key={head} scope="col" className="py-xs text-right font-normal">
              {head}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-t border-dashed border-border">
            <th scope="row" className="py-xs text-left font-normal">
              {row.label}
            </th>
            {row.cells.map((cell, index) => (
              <td key={heads[index]} className="py-xs text-right tabular-nums">
                <NumberRoll value={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const nearKey = ['lavoro', 'near-misses'];

function NearMisses({ jobs, onChanged }: { jobs: JobRow[]; onChanged: () => void }) {
  const client = React.useMemo(() => createModuleClient<typeof definition>('lavoro'), []);
  const cache = useQueryClient();
  const [confirmClear, setConfirmClear] = React.useState(false);
  const near = useQuery({ queryKey: nearKey, queryFn: () => client.nearMisses.query() }).data;
  // A new list means a collection or an edit ended, and either can change the near misses: read them again.
  React.useEffect(() => {
    void cache.invalidateQueries({ queryKey: nearKey });
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- jobs change triggers query invalidation; the query needs no job key. // guard-private: allow Generic lint rule name
  }, [jobs, cache]);
  if (!near) return null;
  const add = async (key: string) => {
    await client.addNearMiss.mutate({ key });
    await cache.invalidateQueries({ queryKey: nearKey });
    onChanged();
  };
  const dismiss = async (key: string) => {
    await client.dismissNearMiss.mutate({ key });
    await cache.invalidateQueries({ queryKey: nearKey });
  };
  const dismissAll = async () => {
    await client.dismissAllNearMisses.mutate();
    setConfirmClear(false);
    await cache.invalidateQueries({ queryKey: nearKey });
  };
  return (
    <>
      <Panel
        title={copy.stats.near_title}
        action={
          near.rows.length > 0 && !confirmClear ? (
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              className="min-h-touch cursor-pointer rounded-full border border-border px-md text-label text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {copy.stats.near_clear_all}
            </button>
          ) : undefined
        }
      >
        {confirmClear && near.rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-sm rounded-md border border-border bg-muted/60 px-md py-sm">
            <span className="text-label">{copy.stats.near_clear_confirm(near.rows.length)}</span>
            <div className="flex items-center gap-sm">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="min-h-touch cursor-pointer rounded-full border border-border px-md text-label hover:bg-muted"
              >
                {copy.stats.near_clear_cancel}
              </button>
              <ActionButton
                size="sm"
                variant="outline"
                label={copy.stats.near_clear_ok}
                labels={{ success: copy.stats.near_dismissed, error: copy.stats.near_dismiss_failed }}
                action={dismissAll}
              />
            </div>
          </div>
        )}
        {near.rows.length === 0 ? (
          <p className="text-label text-muted-foreground">{copy.stats.near_empty}</p>
        ) : (
          <table className="w-full text-label">
            <caption className="sr-only">{copy.stats.near_title}</caption>
            <thead>
              <tr className="text-caption text-muted-foreground">
                <th scope="col" className="w-1/2 py-xs text-left font-normal">
                  {copy.stats.near_posting}
                </th>
                <th scope="col" className="py-xs text-left font-normal">
                  {copy.stats.near_company}
                </th>
                <th scope="col" className="py-xs text-left font-normal">
                  {copy.stats.source}
                </th>
                <th scope="col" className="py-xs text-right font-normal">
                  {copy.stats.near_interest}
                </th>
                <th scope="col" className="py-xs">
                  <span className="sr-only">Azioni</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {near.rows.map((row) => (
                <tr key={row.key} className="border-t border-dashed border-border align-top">
                  <th scope="row" className="max-w-0 py-xs pr-md text-left font-normal">
                    <a href={row.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {row.title}
                    </a>
                    <p className="truncate text-caption text-muted-foreground">
                      {row.reasons.filter((r) => !r.startsWith('stabile:')).join(', ')}
                    </p>
                  </th>
                  <td className="py-xs pr-md">{row.company}</td>
                  <td className="py-xs pr-md">{displayName(copy.stats.sources, row.site)}</td>
                  <td className="py-xs text-right tabular-nums">
                    {row.score}
                    <p className="text-caption whitespace-nowrap text-muted-foreground">
                      {copy.stats.near_missing(row.missing)}
                    </p>
                  </td>
                  <td className="py-xs pl-md text-right">
                    <div className="flex justify-end gap-xs">
                      <ActionButton
                        size="sm"
                        variant="outline"
                        label={copy.stats.near_add}
                        labels={{ success: copy.stats.near_added, error: copy.stats.near_add_failed }}
                        action={() => add(row.key)}
                      />
                      <ActionButton
                        size="sm"
                        variant="outline"
                        label={copy.stats.near_dismiss}
                        labels={{ success: copy.stats.near_dismissed, error: copy.stats.near_dismiss_failed }}
                        action={() => dismiss(row.key)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="text-caption text-muted-foreground">{copy.stats.near_note}</p>
      </Panel>
      {near.words.length > 0 && (
        <Panel title={copy.stats.words_title}>
          <table className="w-full text-label">
            <caption className="sr-only">{copy.stats.words_title}</caption>
            <tbody>
              {near.words.map((entry) => (
                <tr key={entry.word} className="border-t border-dashed border-border first:border-t-0">
                  <th scope="row" className="py-xs text-left font-normal">
                    {entry.word}
                  </th>
                  <td className="py-xs text-right tabular-nums">
                    {copy.stats.words_row(entry.postings, entry.entering)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-caption text-muted-foreground">{copy.stats.words_note}</p>
        </Panel>
      )}
    </>
  );
}

const outcomeHeads = [copy.stats.sent, ...outcomeKeys.map((key) => copy.stats[key])];
const outcomeCells = (outcomes: Outcomes) => [outcomes.sent, ...outcomeKeys.map((key) => outcomes[key])];

export function StatsPage({ jobs, onChanged }: { jobs: JobRow[]; onChanged: () => void }) {
  const first = useFirstResponse().data;
  const now = useNow('clock');
  const stats = applicationStats(jobs, now);
  const { total } = stats;
  const scroll = 'flex flex-col gap-lg pb-xl [&>*]:shrink-0';
  if (total.sent === 0)
    return (
      <div className={scroll}>
        <EmptyState scene="chart" title={copy.stats.empty_title} description={copy.stats.empty_description} />
        <NearMisses jobs={jobs} onChanged={onChanged} />
        <Gaps />
      </div>
    );
  return (
    <div className={scroll}>
      <Panel title={copy.stats.title}>
        <dl className="grid grid-cols-2 gap-lg sm:grid-cols-3 xl:grid-cols-6">
          {[
            { label: copy.stats.sent, value: total.sent, share: null },
            ...outcomeKeys.map((key) => ({
              label: copy.stats[key],
              value: total[key],
              share: percent(total[key], total.sent),
            })),
          ].map((entry) => (
            <div key={entry.label} className="flex flex-col gap-2xs">
              <dt className="text-caption text-muted-foreground">{entry.label}</dt>
              <dd className="flex items-baseline gap-sm">
                <span className="text-display tabular-nums">
                  <NumberRoll value={entry.value} />
                </span>
                <span className="text-caption text-muted-foreground tabular-nums">
                  {entry.share !== null && <NumberRoll value={entry.share} suffix=" %" />}
                </span>
              </dd>
              {entry.label === copy.stats.ghosted && (
                <span className="text-caption text-muted-foreground">
                  {copy.stats.ghosted_after_interview(total.ghostedAfterInterview)}
                </span>
              )}
            </div>
          ))}
        </dl>
        {first && (
          <div className="flex items-baseline gap-md border-t border-dashed border-border pt-md">
            <span className="text-caption text-muted-foreground">{copy.stats.first_response}</span>
            <span className="text-title font-medium">{copy.stats.first_response_after(first.medianDays)}</span>
            <span className="text-caption text-muted-foreground">{copy.stats.first_response_basis(first.count)}</span>
          </div>
        )}
        <p className="text-caption text-muted-foreground">{copy.stats.note}</p>
      </Panel>
      <div className="grid grid-cols-1 gap-lg xl:grid-cols-2">
        <Panel title={copy.stats.by_source}>
          <Table
            caption={copy.stats.by_source}
            first={copy.stats.source}
            heads={outcomeHeads}
            rows={stats.bySource.map((entry) => ({
              label: displayName(copy.stats.sources, entry.site),
              cells: outcomeCells(entry),
            }))}
          />
        </Panel>
        <Panel title={copy.stats.by_verdict}>
          {stats.byVerdict.length === 0 ? (
            <p className="text-label text-muted-foreground">{copy.stats.no_verdicts}</p>
          ) : (
            <Table
              caption={copy.stats.by_verdict}
              first={copy.stats.verdict}
              heads={[copy.stats.judged, ...outcomeHeads]}
              rows={stats.byVerdict.map((entry) => ({
                label: displayName(copy.stats.opinions, entry.possibility),
                cells: [entry.judged, ...outcomeCells(entry)],
              }))}
            />
          )}
        </Panel>
      </div>
      <NearMisses jobs={jobs} onChanged={onChanged} />
      <Gaps />
    </div>
  );
}
