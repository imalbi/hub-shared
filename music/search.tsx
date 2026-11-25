import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import { useQuery } from '@tanstack/react-query';
import { ButtonGroup } from '@/components/ui/button-group.tsx';
import { useMusicTRPC } from './use-music.ts';
import { m } from './copy.ts';
import { PublicPlaylists } from './playlists.tsx';
import { SongRow } from './songs.tsx';

export type SearchType = 'songs' | 'playlists';

/** Cerca (Ricerca.dc): the results of the library column's search, as songs or as public playlists. */
export function SearchResults({
  query,
  type,
  onType,
  onPlay,
  onArtist,
}: {
  query: string;
  type: SearchType;
  onType: (type: SearchType) => void;
  onPlay: (id: string) => void;
  onArtist: (id: string) => void;
}) {
  const trpc = useMusicTRPC();
  const results = useQuery({ ...trpc.search.queryOptions({ query }), enabled: type === 'songs', retry: false });
  return (
    <section aria-label={m.music_results()} className="flex min-h-0 flex-1 flex-col gap-md">
      <div className="flex items-center gap-md">
        <h2 className="flex-1 text-heading">{m.music_results()}</h2>
        <ButtonGroup
          label={m.music_search()}
          collapseLabels={false}
          items={[
            { id: 'songs', label: m.music_search_songs(), active: type === 'songs', onClick: () => onType('songs') },
            {
              id: 'playlists',
              label: m.music_search_playlists(),
              active: type === 'playlists',
              onClick: () => onType('playlists'),
            },
          ]}
        />
      </div>
      {type === 'playlists' ? (
        <PublicPlaylists query={query} onPlaySong={onPlay} onArtist={onArtist} />
      ) : (
        <>
          {results.isError && <output>{m.music_search_error()}</output>}
          {results.isSuccess && results.data.length === 0 && <EmptyState scene="search" title={m.music_empty()} />}
          <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {results.data?.map((song, index) => (
              <SongRow key={`${song.id}-${index}`} song={song} onPlay={onPlay} onArtist={onArtist} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
