import { ArrowClockwiseIcon, SparkleIcon, WarningCircleIcon } from '@phosphor-icons/react';
import * as React from 'react';
import { ActionButton } from '../../apps/web/src/components/ui/action-button.tsx';
import { Badge } from '../../apps/web/src/components/ui/badge.tsx';
import { Tooltip } from '../../apps/web/src/components/ui/tooltip.tsx';
import { LoadingSkeleton } from '../../apps/web/src/components/ui/loading-skeleton.tsx';
import { createModuleClient } from '../../apps/web/src/lib/module-client.ts';
import { codeLabels, copy } from './copy.ts';
import type { Possibility, StoredOpinion } from './opinion-prompt.ts';
import type definition from './server.ts';

type OpinionRecord = {
  verdict: StoredOpinion & { possibility: Possibility };
  createdAt: number;
  outdated: boolean;
};

export function OpinionBlock({ jobKey }: { jobKey: string }) {
  const client = React.useMemo(() => createModuleClient<typeof definition>('lavoro'), []);
  const [loaded, setLoaded] = React.useState<{ key: string; opinion: OpinionRecord | null; error: string } | null>(
    null,
  );
  const [loading, setLoading] = React.useState(false);
  const opinion = loaded?.key === jobKey ? loaded.opinion : undefined;
  const error = loaded?.key === jobKey ? loaded.error : '';

  React.useEffect(() => {
    let active = true;
    void client.opinion
      .query({ key: jobKey })
      .then((result) => {
        if (active) setLoaded({ key: jobKey, opinion: result, error: '' });
      })
      .catch(() => {
        if (active) setLoaded({ key: jobKey, opinion: null, error: 'Parere non disponibile' });
      });
    return () => {
      active = false;
    };
  }, [client, jobKey]);

  async function request() {
    setLoading(true);
    setLoaded((prev) => (prev?.key === jobKey ? { ...prev, error: '' } : prev));
    try {
      const next = await client.requestOpinion.mutate({
        key: jobKey,
        redo: opinion !== undefined && opinion !== null,
      });
      setLoaded({ key: jobKey, opinion: next, error: '' });
    } catch (cause) {
      setLoaded({
        key: jobKey,
        opinion: opinion ?? null,
        error: cause instanceof Error ? cause.message : 'Servizio non disponibile',
      });
    } finally {
      setLoading(false);
    }
  }
  const settingsHint = error === missingSetup || error === 'Chiave non valida';
  const verdict = opinion?.verdict;
  return (
    <section className="flex flex-col gap-xs" aria-label="Parere IA" aria-busy={loading || opinion === undefined}>
      <div className="flex min-h-touch items-center gap-sm">
        <h3 className="text-label">Parere IA</h3>
        {opinion && (
          <span className="ml-auto text-caption text-muted-foreground tabular-nums">
            {new Date(opinion.createdAt).toLocaleDateString('it-IT')}
          </span>
        )}
        {opinion?.outdated && (
          <Badge size="sm" tone="warning">
            Da aggiornare
          </Badge>
        )}
        {opinion ? (
          <Tooltip content="Rifai">
            <button
              type="button"
              aria-label="Rifai"
              disabled={loading}
              onClick={() => void request()}
              className={`cursor-pointer rounded-full p-xs hover:bg-muted hover:text-foreground disabled:cursor-default ${opinion.outdated ? 'text-accent' : 'text-muted-foreground'}`}
            >
              <ArrowClockwiseIcon className={`size-icon-sm ${loading ? 'motion-safe:animate-spin' : ''}`} />
            </button>
          </Tooltip>
        ) : opinion === null ? (
          <ActionButton
            size="sm"
            icon={<SparkleIcon />}
            status={loading ? 'pending' : 'idle'}
            labels={{ pending: 'Attendi' }}
            onClick={() => void request()}
            disabled={loading}
          >
            Chiedi parere
          </ActionButton>
        ) : null}
      </div>
      {opinion === undefined && <LoadingSkeleton label={copy.detail.opinion_loading} rows={5} />}
      {error && (
        <div
          role="alert"
          className={`flex items-start gap-xs rounded-lg border p-sm text-label ${settingsHint ? 'border-danger/20 bg-danger/10 text-danger' : 'border-accent/20 bg-accent/10 text-accent'}`}
        >
          <WarningCircleIcon className="size-icon-sm shrink-0 translate-y-3xs" />
          <p className="min-w-0 flex-1">{error}</p>
          {settingsHint ? (
            <a href="/desk/settings/lavoro" className="shrink-0 underline underline-offset-2">
              Impostazioni
            </a>
          ) : (
            <button
              type="button"
              disabled={loading}
              onClick={() => void request()}
              className="shrink-0 cursor-pointer underline underline-offset-2 disabled:cursor-default disabled:opacity-50"
            >
              Riprova
            </button>
          )}
        </div>
      )}
      {verdict && (
        <div className="flex flex-col gap-sm text-label">
          <Row label="Verdetto" tone={tone[verdict.possibility]}>
            <p className="flex flex-wrap items-baseline gap-x-xs">
              <Badge size="sm" tone={badgeTone[verdict.possibility]}>
                {copy.stats.opinions[verdict.possibility]}
              </Badge>
              {verdict.codes.map((code) => (
                <Badge key={code} size="sm">
                  {codeLabels[code]}
                </Badge>
              ))}
              <span>{verdict.why}</span>
            </p>
          </Row>
          <Row label="Fit" tone="text-success">
            <Items items={verdict.fit} />
          </Row>
          <Row label="Contro" tone="text-danger">
            <Items items={verdict.contro} />
          </Row>
          <Row label="Prossimo passo" tone="text-foreground">
            <p>{verdict.next}</p>
          </Row>
          <Row label="Non verificato" tone="text-muted-foreground">
            <Items items={verdict.unverified} muted />
          </Row>
        </div>
      )}
    </section>
  );
}

const missingSetup = 'Inserisci chiave e profilo nelle impostazioni';
const badgeTone = { alta: 'success', media: 'warning', bassa: 'neutral', fuori: 'danger' } as const;
const tone = {
  alta: 'text-success',
  media: 'text-accent',
  bassa: 'text-muted-foreground',
  fuori: 'text-danger',
} as const;

/** Same label column as the "A favore" summary above it in the detail. */
function Row({ label, tone, children }: { label: string; tone: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-sm gap-y-3xs">
      <h4 className={`w-label-col shrink-0 text-caption font-medium ${tone}`}>{label}</h4>
      <div className="min-w-0 flex-1 text-foreground">{children}</div>
    </div>
  );
}

function Items({ items, muted = false }: { items: string[]; muted?: boolean }) {
  if (items.length === 0) return <p className="text-muted-foreground">Nessuno</p>;
  return (
    <ul
      className={`flex list-disc flex-col gap-3xs pl-md marker:text-muted-foreground ${muted ? 'text-muted-foreground' : ''}`}
    >
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
