import type { inferRouterOutputs } from '../../apps/web/src/lib/module-client.ts';
import type { MusicRouter } from './use-music.ts';
import { AudioButton } from '../../apps/web/src/modules/media/audio-button.tsx';
import { useMedia } from '../../apps/web/src/modules/media/media-provider.tsx';
import { PlayerBar } from '../../apps/web/src/modules/media/player-bar.tsx';
import { AddToPlaylist } from './add-to-playlist.tsx';
import { Favorite } from './favorite.tsx';
import { Artists } from './parts.tsx';
import { useMusicVolume } from './volume.ts';

type Queue = inferRouterOutputs<MusicRouter>['queue'];

/** The player bar with the Musica extras: the current song's artist links, favourite, add to playlist and the volume. */
export function MusicPlayer({ queue, onArtist }: { queue: Queue | undefined; onArtist: (id: string) => void }) {
  const media = useMedia();
  const current = queue?.current;
  const volume = useMusicVolume(current?.id);
  // The queue is Hub's radio; the player may be showing another app's track, whose artist is plain text.
  const linked = current && current.title === media.state?.title;
  return (
    <PlayerBar
      className="absolute -bottom-touch left-1/2 z-10 w-5/6 -translate-x-1/2"
      artist={linked ? <Artists artists={current.artists} onOpen={onArtist} morph /> : undefined}
      actions={
        <>
          {current && <Favorite song={current} />}
          {current && <AddToPlaylist song={current} />}
          <AudioButton music={{ volume: volume.volume, onVolume: volume.set }} />
        </>
      }
    />
  );
}
