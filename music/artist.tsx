import { LoadingSkeleton } from '../../apps/web/src/components/ui/loading-skeleton.tsx';
import { FadeImage } from '../../apps/web/src/components/fade-image.tsx';
import { useQuery } from '@tanstack/react-query';
import { CaretLeftIcon } from '@phosphor-icons/react';
import { useMusicTRPC } from './use-music.ts';
import { m } from './copy.ts';
import { pillOutline } from './parts.tsx';
import { SongRow } from './songs.tsx';

/** The artist page (Artista.dc): a banner with the name over it, the top songs and the albums side by side. */
export function ArtistView({
  id,
  onBack,
  onPlay,
  onArtist,
}: {
  id: string;
  onBack: () => void;
  onPlay: (id: string) => void;
  onArtist: (id: string) => void;
}) {
  const trpc = useMusicTRPC();
  const artist = useQuery({ ...trpc.artist.queryOptions({ id }), retry: false });
  return (
    <section aria-label={artist.data?.name} className="flex min-h-0 flex-1 flex-col gap-lg">
      <div className="relative flex h-artist-banner shrink-0 flex-col justify-between overflow-hidden rounded-lg bg-muted p-lg">
        {artist.data?.banner && (
          <FadeImage src={artist.data.banner} alt="" className="absolute inset-0 size-full object-cover" />
        )}
        <div className="absolute inset-0 bg-linear-to-t from-background to-transparent" aria-hidden />
        <button type="button" className={`${pillOutline} desk-glass relative self-start`} onClick={onBack}>
          <CaretLeftIcon aria-hidden="true" />
          {m.music_artist_back()}
        </button>
        <h2 className="relative truncate text-hero">{artist.data?.name}</h2>
      </div>
      {artist.isLoading && <LoadingSkeleton label={m.music_artist_loading()} rows={5} />}
      {artist.isError && <output>{m.music_artist_error()}</output>}
      {artist.data && (
        <div className="grid min-h-0 flex-1 grid-cols-5 gap-xl">
          <section aria-labelledby="artist-top" className="col-span-3 flex min-h-0 flex-col gap-xs">
            <h3 id="artist-top" className="text-title">
              {m.music_artist_songs()}
            </h3>
            <ol className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              {artist.data.songs.map((song, index) => (
                <SongRow key={song.id} song={song} position={index + 1} onPlay={onPlay} onArtist={onArtist} />
              ))}
            </ol>
          </section>
          <section aria-labelledby="artist-albums" className="col-span-2 flex min-h-0 flex-col gap-md">
            <h3 id="artist-albums" className="text-title">
              {m.music_artist_albums()}
            </h3>
            <ul className="grid min-h-0 flex-1 grid-cols-3 content-start gap-md overflow-y-auto overscroll-contain">
              {artist.data.albums.map((album, index) => (
                <li key={`${album.title}-${index}`} className="flex flex-col gap-xs">
                  <div className="aspect-square overflow-hidden rounded-lg bg-muted">
                    {album.cover && <FadeImage src={album.cover} alt="" className="size-full object-cover" />}
                  </div>
                  <p className="text-label">{album.title}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </section>
  );
}
