import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActionButton } from '../../apps/web/src/components/ui/action-button.tsx';
import { Input } from '../../apps/web/src/components/ui/input.tsx';
import { useWeatherTRPC } from './use-weather.ts';
import { m } from './copy.ts';

export function LocationSearch({ onSelect }: { onSelect: (location: unknown) => void }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const trpc = useWeatherTRPC();
  const results = useQuery({ ...trpc.search.queryOptions(query), enabled: query.length >= 2, retry: false });
  return (
    <div className="flex flex-col gap-sm">
      <form
        className="flex items-end gap-sm"
        onSubmit={(event) => {
          event.preventDefault();
          const next = text.trim();
          if (next === query) void results.refetch();
          else setQuery(next);
        }}
      >
        <Input label={m.weather_search()} hint={m.weather_search_hint()} value={text} onValueChange={setText} />
        <ActionButton type="submit" variant="outline" disabled={text.trim().length < 2}>
          {m.weather_search_action()}
        </ActionButton>
      </form>
      {results.isFetching && <output>{m.tile_loading()}</output>}
      {results.isError && <p role="alert">{m.weather_search_error()}</p>}
      {results.data?.length === 0 && <p>{m.weather_search_empty()}</p>}
      {results.data?.map((place) => (
        <button
          type="button"
          className="min-h-touch text-left text-body"
          key={`${place.latitude}-${place.longitude}`}
          onClick={() => {
            onSelect({ name: place.name, latitude: place.latitude, longitude: place.longitude });
            setQuery('');
            setText('');
          }}
        >
          {[place.name, place.admin2, place.admin1, place.country].filter(Boolean).join(', ')}
        </button>
      ))}
    </div>
  );
}
