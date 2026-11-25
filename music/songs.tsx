import { Favorite } from './favorite.tsx';
import { AddToPlaylist } from './add-to-playlist.tsx';
import { Artists, CoverTile, Duration, type SongItem } from './parts.tsx';
import { m } from './copy.ts';
import { AnimatedRow } from '../../apps/web/src/components/animated-list.tsx';

/**
 * One song as a row: the title button plays and stretches over the whole row (`after:inset-0`), so the cover and the
 * gaps play too; the artist links and the buttons on the right sit above it (`z-10`).
 */
export function SongRow({
  song,
  onPlay,
  onArtist,
  position,
  lazy,
}: {
  song: SongItem;
  onPlay: (id: string) => void;
  onArtist: (id: string) => void;
  position?: number;
  lazy?: boolean;
}) {
  return (
    <AnimatedRow className="relative flex items-center gap-md border-t border-dashed border-border py-xs">
      {position !== undefined && <span className="w-md text-label text-muted-foreground tabular-nums">{position}</span>}
      <CoverTile src={song.cover} lazy={lazy} />
      <div className="min-w-0 flex-1">
        <button
          type="button"
          aria-label={m.music_play({ title: song.title })}
          className="block max-w-full truncate text-left text-body after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => onPlay(song.id)}
        >
          {song.title}
        </button>
        <p className="truncate text-caption text-muted-foreground">
          <Artists artists={song.artists} onOpen={onArtist} />
        </p>
      </div>
      <Duration seconds={song.seconds} />
      <div className="relative z-10 flex">
        <Favorite song={song} />
        <AddToPlaylist song={song} />
      </div>
    </AnimatedRow>
  );
}
