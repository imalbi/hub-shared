import { HeartIcon } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMusicTRPC } from './use-music.ts';
import { m } from './copy.ts';

type Track = { id: string; title: string; artists: { name: string }[] };

export function Favorite({ song }: { song: Track }) {
  const trpc = useMusicTRPC();
  const client = useQueryClient();
  const favorites = useQuery(trpc.favorites.queryOptions());
  const toggle = useMutation(
    trpc.toggleFavorite.mutationOptions({
      onSuccess: () => client.invalidateQueries({ queryKey: trpc.favorites.queryKey() }),
    }),
  );
  const selected = favorites.data?.some((item) => item.id === song.id) ?? false;
  return (
    <button
      type="button"
      aria-label={m.music_favorite({ title: song.title })}
      aria-pressed={selected}
      className="flex size-touch shrink-0 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
      disabled={toggle.isPending || !favorites.isSuccess}
      onClick={() =>
        toggle.mutate({ id: song.id, title: song.title, artist: song.artists.map((artist) => artist.name).join(', ') })
      }
    >
      <HeartIcon aria-hidden="true" weight={selected ? 'fill' : 'regular'} />
    </button>
  );
}
