import { QueueIcon } from '@phosphor-icons/react';
import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import { AnimatedRows } from '../../apps/web/src/components/animated-list.tsx';
import { useMutation, useQuery } from '@tanstack/react-query';
import { m } from './copy.ts';
import { useMusicTRPC } from './use-music.ts';
import { CoverTile, pillOutline, type SongItem } from './parts.tsx';
import { SongRow } from './songs.tsx';

/** A square artwork tile used across the suggestion and recent rows on Ascolta. */
function ListenTile({
  label,
  title,
  subtitle,
  cover,
  onClick,
}: {
  label?: string;
  title: string;
  subtitle?: string;
  cover: string | null;
  onClick: () => void;
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        aria-label={label}
        className="flex w-full flex-col gap-xs text-left focus-visible:outline-2 focus-visible:outline-ring"
        onClick={onClick}
      >
        <CoverTile src={cover} className="aspect-square w-full rounded-lg" />
        <span className="truncate text-label">{title}</span>
        {subtitle && <span className="-mt-xs truncate text-caption text-muted-foreground">{subtitle}</span>}
      </button>
    </li>
  );
}

/** Ascolta (AltC): personalized suggestions from Hub when history exists, recent songs, and the radio queue with its skip and stop buttons. */
export function Listen({
  queue,
  onPlay,
  onArtist,
}: {
  queue: { current: SongItem | null; seed: { title: string } | null; upcoming: SongItem[]; errors: number } | undefined;
  onPlay: (id: string) => void;
  onArtist: (id: string) => void;
}) {
  const trpc = useMusicTRPC();
  const suggestions = useQuery(trpc.suggestions.queryOptions()).data;
  const recent = useQuery(trpc.recent.queryOptions()).data ?? [];
  const skip = useMutation(trpc.skip.mutationOptions());
  const stop = useMutation(trpc.stop.mutationOptions());
  const again = suggestions?.again ?? [];
  const radios = suggestions?.radios ?? [];
  const similar = suggestions?.similar && suggestions.similar.artists.length > 0 ? suggestions.similar : null;
  const hasSuggestions = again.length > 0 || radios.length > 0 || similar !== null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-lg overflow-y-auto overscroll-contain">
      {hasSuggestions && (
        <section aria-labelledby="music-for-you" className="flex shrink-0 flex-col gap-md">
          <h2 id="music-for-you" className="text-heading">
            {m.music_for_you()}
          </h2>
          {again.length > 0 && (
            <section aria-labelledby="music-again" className="flex flex-col gap-sm">
              <h3 id="music-again" className="text-title">
                {m.music_again()}
              </h3>
              <ul className="grid grid-cols-6 gap-md">
                {again.map((song) => (
                  <ListenTile
                    key={song.id}
                    label={m.music_play({ title: song.title })}
                    title={song.title}
                    subtitle={song.artist || undefined}
                    cover={song.cover}
                    onClick={() => onPlay(song.id)}
                  />
                ))}
              </ul>
            </section>
          )}
          {radios.length > 0 && (
            <section aria-labelledby="music-radios" className="flex flex-col gap-sm">
              <h3 id="music-radios" className="text-title">
                {m.music_radios()}
              </h3>
              <ul className="grid grid-cols-6 gap-md">
                {radios.map((radio) => (
                  <ListenTile
                    key={radio.artist}
                    label={m.music_radio_start({ artist: radio.artist })}
                    title={m.music_radio_artist({ artist: radio.artist })}
                    subtitle={radio.seed.title}
                    cover={radio.seed.cover}
                    onClick={() => onPlay(radio.seed.id)}
                  />
                ))}
              </ul>
            </section>
          )}
          {similar && (
            <section aria-labelledby="music-similar" className="flex flex-col gap-sm">
              <h3 id="music-similar" className="text-title">
                {m.music_similar_to({ artist: similar.of })}
              </h3>
              <ul className="grid grid-cols-6 gap-md">
                {similar.artists.map((artist) => (
                  <ListenTile
                    key={artist.id}
                    title={artist.name}
                    cover={artist.cover}
                    onClick={() => onArtist(artist.id)}
                  />
                ))}
              </ul>
            </section>
          )}
        </section>
      )}
      {recent.length > 0 && (
        <section aria-labelledby="music-recent" className="flex shrink-0 flex-col gap-md">
          <h2 id="music-recent" className="text-heading">
            {m.music_recent()}
          </h2>
          <ul className="grid grid-cols-5 gap-md">
            {recent.map((song) => (
              <ListenTile
                key={song.id}
                label={m.music_play({ title: song.title })}
                title={song.title}
                subtitle={song.artist || undefined}
                cover={song.cover}
                onClick={() => onPlay(song.id)}
              />
            ))}
          </ul>
        </section>
      )}
      <section aria-label={m.music_next()} className="flex shrink-0 flex-col gap-sm">
        <div className="flex items-center gap-md">
          <h2 className="flex-1 text-heading">{m.music_next()}</h2>
          {queue?.current && queue.seed && (
            <p className="truncate text-label text-muted-foreground">
              {m.music_radio_from({ title: queue.seed.title })}
            </p>
          )}
          {queue?.current && (
            <>
              <button type="button" className={pillOutline} onClick={() => skip.mutate()} disabled={skip.isPending}>
                {m.music_skip()}
              </button>
              <button type="button" className={pillOutline} onClick={() => stop.mutate()} disabled={stop.isPending}>
                {m.music_stop()}
              </button>
            </>
          )}
        </div>
        {!queue?.current &&
          (hasSuggestions || recent.length > 0 ? (
            <EmptyState
              variant="inline"
              icon={<QueueIcon className="size-icon" aria-hidden="true" />}
              title={m.music_queue_empty()}
            />
          ) : (
            <EmptyState scene="music" title={m.music_queue_empty()} />
          ))}
        {queue?.errors === 3 && <output>{m.music_radio_error()}</output>}
        {(skip.isError || stop.isError) && <output>{m.music_player_error()}</output>}
        <ul className="grid grid-cols-2 content-start gap-x-xl">
          <AnimatedRows>
            {queue?.upcoming.map((song) => (
              <SongRow key={song.id} song={song} onPlay={onPlay} onArtist={onArtist} />
            ))}
          </AnimatedRows>
        </ul>
      </section>
    </div>
  );
}
