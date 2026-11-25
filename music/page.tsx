import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import { AnimatedRows } from '../../apps/web/src/components/animated-list.tsx';
import { FadeImage } from '../../apps/web/src/components/fade-image.tsx';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSubscription } from '@trpc/tanstack-react-query';
import { SearchInput } from '@/components/ui/search-input.tsx';
import { useMusicTRPC } from './use-music.ts';
import { m } from './copy.ts';
import { useMedia } from '../../apps/web/src/modules/media/media-provider.tsx';
import { ArtistView } from './artist.tsx';
import { Listen } from './listen.tsx';
import { pillQuiet, type SongItem } from './parts.tsx';
import { LocalPlaylist, PlaylistList } from './playlists.tsx';
import { MusicPlayer } from './player.tsx';
import { SearchResults, type SearchType } from './search.tsx';
import { SongRow } from './songs.tsx';

type Library = 'listen' | 'favorites' | 'history';

/** Favourites and history are the same list of saved songs (Ricerca.dc, note n1): one title each, no search. */
function SavedSongs({
  kind,
  onPlay,
  onArtist,
}: {
  kind: 'favorites' | 'history';
  onPlay: (id: string) => void;
  onArtist: (id: string) => void;
}) {
  const trpc = useMusicTRPC();
  const favorites = useQuery(trpc.favorites.queryOptions());
  const history = useQuery(trpc.history.queryOptions());
  const rows = (kind === 'favorites' ? favorites : history).data;
  const label = kind === 'favorites' ? m.music_favorites() : m.music_history();
  const songs = (rows ?? []).map((row) => ({
    key: kind === 'history' && 'playedAt' in row ? `${row.id}-${row.playedAt}` : row.id,
    song: {
      id: row.id,
      title: row.title,
      artists: row.artist ? [{ name: row.artist }] : [],
      cover: `/m/music/cover/${encodeURIComponent(row.id)}`,
    } satisfies SongItem,
  }));
  return (
    <section aria-label={label} className="flex min-h-0 flex-1 flex-col gap-md">
      <h2 className="text-heading">{label}</h2>
      {rows?.length === 0 && (
        <EmptyState scene="music" title={kind === 'favorites' ? m.music_favorites_empty() : m.music_history_empty()} />
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <AnimatedRows>
          {songs.map(({ key, song }) => (
            <SongRow key={key} song={song} onPlay={onPlay} onArtist={onArtist} lazy />
          ))}
        </AnimatedRows>
      </ul>
    </section>
  );
}

/**
 * Space plays or pauses, except where it already means something: a field, a button, a slider, a link or a dialog.
 * A component of its own so the media ticks re-render only it, not the whole page.
 */
function SpaceToggle() {
  const media = useMedia();
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== 'Space' || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (
        event.target instanceof Element &&
        event.target.closest('input, textarea, select, button, a, [role=slider], [role=dialog], [contenteditable]')
      )
        return;
      event.preventDefault();
      media.playPause.mutate();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [media.playPause]);
  return null;
}

/** The current cover, blurred and dimmed, behind the page; it clips itself because the surface does not (`float`). */
function CoverBackdrop() {
  const { art } = useMedia();
  if (!art) return null;
  return (
    <div aria-hidden data-music-backdrop className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
      <FadeImage src={art.dataUrl} alt="" opacity={0.1} className="size-full scale-125 object-cover blur-art" />
    </div>
  );
}

/**
 * The Musica page (alternative C, "libreria a lato"): the library column (search, Ascolta, Preferiti, Cronologia,
 * playlists) beside one content view, and the player floating over the surface's bottom edge
 * (`float` tab: the surface does not clip it). The view is local state: the artist page opens
 * over whatever was showing and "Torna indietro" returns to it.
 */
export function MusicPage() {
  const trpc = useMusicTRPC();
  const client = useQueryClient();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<SearchType>('songs');
  const [library, setLibrary] = useState<Library>('listen');
  const [playlistId, setPlaylistId] = useState<number | null>(null);
  const [artistId, setArtistId] = useState<string | null>(null);
  const queue = useSubscription(trpc.onQueue.subscriptionOptions()).data;
  const play = useMutation(
    trpc.play.mutationOptions({
      // A play can start the player service afresh, at mpv's own default volume.
      onSuccess: () => client.invalidateQueries({ queryKey: trpc.state.queryKey() }),
    }),
  );
  const onPlay = (id: string) => play.mutate({ id });

  // A library entry or a playlist leaves the search and the artist page.
  const open = (next: Library, id: number | null = null) => {
    setText('');
    setQuery('');
    setArtistId(null);
    setLibrary(next);
    setPlaylistId(id);
  };
  const current = playlistId === null && !query.trim() && !artistId ? library : null;
  const entries: [Library, string][] = [
    ['listen', m.music_listen()],
    ['favorites', m.music_favorites()],
    ['history', m.music_history()],
  ];

  let content;
  if (artistId)
    content = <ArtistView id={artistId} onBack={() => setArtistId(null)} onPlay={onPlay} onArtist={setArtistId} />;
  else if (query.trim())
    content = (
      <SearchResults query={query} type={searchType} onType={setSearchType} onPlay={onPlay} onArtist={setArtistId} />
    );
  else if (playlistId !== null)
    content = <LocalPlaylist id={playlistId} onBack={() => open('listen')} onPlaySong={onPlay} />;
  else if (library === 'listen') content = <Listen queue={queue} onPlay={onPlay} onArtist={setArtistId} />;
  else content = <SavedSongs kind={library} onPlay={onPlay} onArtist={setArtistId} />;

  return (
    <>
      <SpaceToggle />
      <CoverBackdrop />
      {/* The bottom room keeps the lists clear of the part of the floating player that overlaps the surface. */}
      <div className="relative flex min-h-0 flex-1 gap-xl pb-2xl">
        <div className="flex w-library-col shrink-0 flex-col gap-lg border-r border-dashed border-border pr-lg">
          <SearchInput
            aria-label={m.music_search()}
            placeholder={m.music_search()}
            clearLabel={m.music_clear()}
            shortcut={null}
            value={text}
            onValueChange={setText}
            onSearch={setQuery}
          />
          <nav aria-label={m.music_library()} className="flex flex-col gap-2xs">
            {entries.map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-current={current === id ? 'page' : undefined}
                className={`${pillQuiet} w-full justify-start text-body ${current === id ? 'bg-muted' : ''}`}
                onClick={() => open(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <PlaylistList selected={playlistId} onSelect={(id) => open(library, id)} />
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-md">
          {play.isError && <output>{m.music_player_error()}</output>}
          {content}
        </div>
      </div>
      <MusicPlayer queue={queue} onArtist={setArtistId} />
    </>
  );
}
