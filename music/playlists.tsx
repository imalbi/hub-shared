import { EmptyState } from '../../apps/web/src/components/ui/empty-state.tsx';
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretLeftIcon,
  MusicNotesIcon,
  PlayIcon,
  PlusIcon,
  XIcon,
} from '@phosphor-icons/react';
import { Popover } from '@/components/ui/popover.tsx';
import { Input } from '@/components/ui/input.tsx';
import { HoldButton } from '@/components/hold-button.tsx';
import { useMusicTRPC } from './use-music.ts';
import { m } from './copy.ts';
import { CoverTile, iconButton, PlaylistCover, PlaylistMosaic, pillOutline, pillPrimary } from './parts.tsx';
import { NewPlaylist } from './add-to-playlist.tsx';
import { SongRow } from './songs.tsx';

/** The library column's playlist list: the header with the create popover, then one row per playlist. */
export function PlaylistList({ selected, onSelect }: { selected: number | null; onSelect: (id: number) => void }) {
  const trpc = useMusicTRPC();
  const lists = useQuery(trpc.playlists.queryOptions());
  return (
    <section aria-label={m.music_playlists()} className="flex min-h-0 flex-1 flex-col gap-xs">
      <div className="flex items-center gap-xs pl-md">
        <h2 className="flex-1 text-label text-muted-foreground">{m.music_playlists()}</h2>
        <Popover
          label={m.music_playlist_new()}
          align="start"
          trigger={
            <button type="button" className={iconButton} aria-label={m.music_playlist_create()}>
              <PlusIcon aria-hidden="true" />
            </button>
          }
        >
          {({ close }) => <NewPlaylist onCreated={() => close()} />}
        </Popover>
      </div>
      {lists.data?.length === 0 && (
        <EmptyState
          variant="compact"
          icon={<MusicNotesIcon className="size-icon-lg" aria-hidden="true" />}
          title={m.music_playlist_empty()}
        />
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {lists.data?.map((list) => (
          <li key={list.id}>
            <button
              type="button"
              aria-current={selected === list.id ? 'page' : undefined}
              className={`flex w-full items-center gap-sm rounded-full p-2xs pr-md text-left text-body focus-visible:outline-2 focus-visible:outline-ring ${selected === list.id ? 'bg-muted' : 'hover:bg-muted'}`}
              onClick={() => onSelect(list.id)}
            >
              <PlaylistMosaic covers={list.covers} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{list.name}</span>
                <span className="truncate text-caption text-muted-foreground">
                  {m.music_playlist_count({ count: list.count })}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const back = `${pillOutline} self-start`;

export function LocalPlaylist({
  id,
  onBack,
  onPlaySong,
}: {
  id: number;
  onBack: () => void;
  onPlaySong: (id: string) => void;
}) {
  const trpc = useMusicTRPC();
  const client = useQueryClient();
  const list = useQuery(trpc.playlist.queryOptions({ id }));
  // The list rows show the count and the first covers, so they follow every change too.
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: trpc.playlist.queryKey({ id }) }),
      client.invalidateQueries({ queryKey: trpc.playlists.queryKey() }),
    ]);
  const move = useMutation(trpc.movePlaylistSong.mutationOptions({ onSuccess: refresh }));
  const remove = useMutation(trpc.removePlaylistSong.mutationOptions({ onSuccess: refresh }));
  const rename = useMutation(
    trpc.renamePlaylist.mutationOptions({
      onSuccess: () => {
        void refresh();
        void client.invalidateQueries({ queryKey: trpc.playlists.queryKey() });
        setEditing(false);
      },
    }),
  );
  const del = useMutation(trpc.deletePlaylist.mutationOptions());
  const play = useMutation(trpc.playPlaylist.mutationOptions());
  const [editing, setEditing] = React.useState(false);
  const field = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);
  const [name, setName] = React.useState('');
  const songs = list.data?.songs ?? [];
  return (
    <section aria-label={list.data?.name} className="flex min-h-0 flex-1 flex-col gap-lg">
      <button type="button" className={back} onClick={onBack}>
        <CaretLeftIcon aria-hidden="true" />
        {m.music_playlist_back()}
      </button>
      <form
        className="flex items-end gap-lg"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) rename.mutate({ id, name });
        }}
      >
        <PlaylistMosaic
          covers={songs.flatMap((song) => (song.cover ? [song.cover] : [])).slice(0, 4)}
          className="size-4xl rounded-xl"
        />
        <div className="min-w-0 flex-1">
          {editing ? (
            <Input
              aria-label={m.music_playlist_name()}
              value={name}
              onValueChange={setName}
              ref={field}
              onKeyDown={(event) => event.key === 'Escape' && setEditing(false)}
            />
          ) : (
            <h2 className="truncate text-display">{list.data?.name}</h2>
          )}
        </div>
        <button
          type="button"
          className={pillPrimary}
          disabled={!songs.length || play.isPending}
          onClick={() => play.mutate({ id })}
        >
          <PlayIcon aria-hidden="true" weight="fill" />
          {m.music_playlist_play()}
        </button>
        {/* Two elements, not one whose type flips: the flip turned the opening click into a submit. */}
        {editing ? (
          <button key="save" type="submit" className={pillOutline} disabled={!name.trim()}>
            {m.music_playlist_rename()}
          </button>
        ) : (
          <button
            key="edit"
            type="button"
            className={pillOutline}
            onClick={() => {
              setName(list.data?.name ?? '');
              setEditing(true);
            }}
          >
            {m.music_playlist_rename()}
          </button>
        )}
        <HoldButton
          label={m.music_playlist_delete()}
          idle={m.music_playlist_delete_idle()}
          done={m.music_playlist_deleted()}
          outline
          onConfirm={async () => {
            await del.mutateAsync({ id, confirmed: true });
            await client.invalidateQueries({ queryKey: trpc.playlists.queryKey() });
            onBack();
          }}
        />
      </form>
      {list.data && songs.length === 0 && <EmptyState scene="music" title={m.music_playlist_no_songs()} />}
      <ol className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {songs.map((song, index) => (
          <li key={index} className="relative flex items-center gap-md border-t border-dashed border-border py-xs">
            <span className="w-md text-label text-muted-foreground tabular-nums">{index + 1}</span>
            <CoverTile src={song.cover} />
            <div className="min-w-0 flex-1">
              <button
                type="button"
                aria-label={m.music_play({ title: song.title })}
                className="block max-w-full truncate text-left text-body after:absolute after:inset-0 focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => onPlaySong(song.id)}
              >
                {song.title}
              </button>
              <p className="truncate text-caption text-muted-foreground">{song.artist}</p>
            </div>
            <div className="relative z-10 flex">
              <button
                type="button"
                className={iconButton}
                aria-label={m.music_playlist_move_up({ title: song.title })}
                disabled={index === 0 || move.isPending}
                onClick={() => move.mutate({ playlistId: id, from: index, to: index - 1 })}
              >
                <ArrowUpIcon aria-hidden="true" />
              </button>
              <button
                type="button"
                className={iconButton}
                aria-label={m.music_playlist_move_down({ title: song.title })}
                disabled={index === songs.length - 1 || move.isPending}
                onClick={() => move.mutate({ playlistId: id, from: index, to: index + 1 })}
              >
                <ArrowDownIcon aria-hidden="true" />
              </button>
              <button
                type="button"
                className={iconButton}
                aria-label={m.music_playlist_remove({ title: song.title })}
                disabled={remove.isPending}
                onClick={() => remove.mutate({ playlistId: id, position: index })}
              >
                <XIcon aria-hidden="true" />
              </button>
            </div>
          </li>
        ))}
      </ol>
      {(list.isError || play.isError || rename.isError || remove.isError || move.isError) && (
        <output>{m.music_playlist_error()}</output>
      )}
    </section>
  );
}

/** Public playlists found by the search: the list of them, then one opened with its songs. */
export function PublicPlaylists({
  query,
  onPlaySong,
  onArtist,
}: {
  query: string;
  onPlaySong: (id: string) => void;
  onArtist: (id: string) => void;
}) {
  const trpc = useMusicTRPC();
  const client = useQueryClient();
  const [id, setId] = React.useState<string | null>(null);
  const results = useQuery({
    ...trpc.searchPlaylists.queryOptions({ query }),
    enabled: !!query.trim(),
    retry: false,
  });
  const list = useQuery({
    ...trpc.publicPlaylist.queryOptions({ id: id ?? '' }),
    enabled: id !== null,
    retry: false,
  });
  const play = useMutation(trpc.playPublicPlaylist.mutationOptions());
  const save = useMutation(
    trpc.savePublicPlaylist.mutationOptions({
      onSuccess: () => client.invalidateQueries({ queryKey: trpc.playlists.queryKey() }),
    }),
  );
  if (id === null)
    return (
      <>
        {results.isSuccess && results.data.length === 0 && <EmptyState scene="search" title={m.music_empty()} />}
        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {results.isError && <output>{m.music_search_error()}</output>}
          {results.data?.map((item) => (
            <li key={item.id} className="border-t border-dashed border-border py-xs">
              <button
                type="button"
                className="flex w-full items-center gap-md rounded-full text-left text-body focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => setId(item.id)}
              >
                <PlaylistCover />
                {item.title}
              </button>
            </li>
          ))}
        </ul>
      </>
    );
  return (
    <section aria-label={list.data?.title} className="flex min-h-0 flex-1 flex-col gap-lg">
      <div className="flex items-center gap-sm">
        <button type="button" className={back} onClick={() => setId(null)}>
          <CaretLeftIcon aria-hidden="true" />
          {m.music_artist_back()}
        </button>
        <h2 className="min-w-0 flex-1 truncate text-heading">{list.data?.title}</h2>
        <button
          type="button"
          className={pillPrimary}
          disabled={!list.data?.songs.length}
          onClick={() => play.mutate({ id })}
        >
          <PlayIcon aria-hidden="true" weight="fill" />
          {m.music_playlist_play()}
        </button>
        <button
          type="button"
          className={pillOutline}
          disabled={!list.data || save.isPending}
          onClick={() => save.mutate({ id })}
        >
          {m.music_playlist_save()}
        </button>
      </div>
      {list.data && list.data.songs.length === 0 && <EmptyState scene="music" title={m.music_playlist_no_songs()} />}
      <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {list.data?.songs.map((song, index) => (
          <SongRow key={`${song.id}-${index}`} song={song} onPlay={onPlaySong} onArtist={onArtist} />
        ))}
      </ul>
      {(list.isError || play.isError || save.isError) && <output>{m.music_playlist_error()}</output>}
    </section>
  );
}
