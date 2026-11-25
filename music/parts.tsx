import * as React from 'react';
import { MusicNoteIcon, MusicNotesIcon } from '@phosphor-icons/react';
import { FadeImage } from '../../apps/web/src/components/fade-image.tsx';

export type SongItem = {
  id: string;
  title: string;
  artists: { name: string; id?: string }[];
  cover?: string | null;
  seconds?: number;
};

/** A pill button: the house shape for text controls on the Musica page. */
export const pill =
  'inline-flex h-touch items-center gap-xs rounded-full px-md text-label focus-visible:outline-2 focus-visible:outline-ring';
export const pillQuiet = `${pill} text-foreground hover:bg-muted`;
export const pillOutline = `${pill} border border-border text-foreground hover:bg-muted`;
export const pillPrimary = `${pill} bg-primary text-primary-foreground disabled:opacity-60`;
export const iconButton =
  'flex size-touch shrink-0 items-center justify-center rounded-full hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring';

/** A cover, or a note on a muted tile when the source has none (or fails lazily). */
export function CoverTile({
  src,
  className = 'size-2xl rounded-md',
  lazy = false,
}: {
  src?: string | null;
  className?: string;
  lazy?: boolean;
}) {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const showImage = Boolean(src) && (!lazy || failedSrc !== src);
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center overflow-hidden bg-muted ${className}`}>
      {showImage && src ? (
        <FadeImage
          src={src}
          alt=""
          className="size-full object-cover"
          loading={lazy ? 'lazy' : undefined}
          onError={lazy ? () => setFailedSrc(src) : undefined}
        />
      ) : (
        <MusicNoteIcon className="size-icon" />
      )}
    </span>
  );
}

export function Artists({
  artists,
  onOpen,
  morph = false,
}: {
  artists: { name: string; id?: string }[];
  onOpen: (id: string) => void;
  morph?: boolean;
}) {
  return artists.map((artist, index) => {
    const id = artist.id;
    const name = artist.name;
    return (
      <React.Fragment key={morph ? index : `${artist.name}-${index}`}>
        {index > 0 && ', '}
        {id && /^UC[A-Za-z0-9_-]{22}$/.test(id) ? (
          <button
            type="button"
            className="relative z-10 max-w-full truncate align-bottom hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => onOpen(id)}
          >
            {name}
          </button>
        ) : (
          name
        )}
      </React.Fragment>
    );
  });
}

export function Duration({ seconds }: { seconds?: number }) {
  if (seconds === undefined) return null;
  return (
    <span className="text-caption text-muted-foreground tabular-nums">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
    </span>
  );
}

/** The cover of a playlist: songs keep no artwork, so a note on a muted tile stands for it. */
export function PlaylistCover({ className = 'size-2xl rounded-md' }: { className?: string }) {
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center bg-muted ${className}`}>
      <MusicNotesIcon className="size-icon" />
    </span>
  );
}

/** A playlist row's cover: the first songs' thumbnails as a 2x2 mosaic, one thumbnail when fewer than four, else the note tile. */
export function PlaylistMosaic({
  covers,
  className = 'size-2xl rounded-md',
}: {
  covers: string[];
  className?: string;
}) {
  const [first] = covers;
  if (!first) return <PlaylistCover className={className} />;
  if (covers.length < 4) return <CoverTile src={first} className={className} />;
  return (
    <span aria-hidden className={`grid shrink-0 grid-cols-2 overflow-hidden bg-muted ${className}`}>
      {covers.map((src, index) => (
        <FadeImage key={index} src={src} alt="" className="size-full object-cover" />
      ))}
    </span>
  );
}
