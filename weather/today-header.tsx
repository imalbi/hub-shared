import { TextMorph } from '../../apps/web/src/components/ui/text-morph.tsx';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useWeatherTRPC } from './use-weather.ts';
import { m } from './copy.ts';
/** The weather in a block (Grande, Largo) or one caption (Medio, Esteso); without data while on, it says so. */
export function Weather({ look, align = 'start' }: { look: 'block' | 'caption'; align?: 'start' | 'end' }) {
  const trpc = useWeatherTRPC();
  const weather = useQuery({ ...trpc.state.queryOptions(), refetchInterval: 60_000 });
  if (!weather.isSuccess) return null;
  const { current, configured } = weather.data;
  if (!current)
    return (
      <p className="text-caption text-muted-foreground">
        {configured ? (
          m.today_weather_unreachable()
        ) : (
          <>
            {m.today_weather_missing()} ·{' '}
            <Link to="/desk/settings/$module" params={{ module: 'weather' }} className="underline">
              {m.today_weather_set()}
            </Link>
          </>
        )}
      </p>
    );
  const stale = current.stale ? 'opacity-60' : '';
  const title = current.stale ? m.weather_stale() : undefined;
  if (look === 'caption')
    return (
      <p className={`text-caption text-muted-foreground tabular-nums ${stale}`} title={title}>
        <TextMorph animateWidth={false}>{`${Math.round(current.temperature)}° · ${current.name}`}</TextMorph>
      </p>
    );
  return (
    <div className={`flex flex-col ${align === 'end' ? 'items-end text-right' : ''} ${stale}`} title={title}>
      <p className="text-caption text-muted-foreground">
        <TextMorph animateWidth={false}>{current.name}</TextMorph>
      </p>
      <p className="text-display tabular-nums">
        <TextMorph animateWidth={false}>{`${Math.round(current.temperature)}°`}</TextMorph>
      </p>
      <p className="text-caption text-muted-foreground tabular-nums">
        {Math.round(current.min)}° / {Math.round(current.max)}°
      </p>
    </div>
  );
}
