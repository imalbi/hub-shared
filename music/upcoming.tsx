import { useSubscription } from '@trpc/tanstack-react-query';
import { useMusicTRPC } from './use-music.ts';
export function UpcomingTracks() {
  const trpc = useMusicTRPC();
  const queue = useSubscription(trpc.onQueue.subscriptionOptions()).data;
  const upcoming = queue?.upcoming.slice(0, 3) ?? [];
  if (upcoming.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3xs">
      <p className="text-caps text-muted-foreground">{'Prossimi'}</p>
      <ul className="flex min-w-0 flex-col gap-3xs">
        {upcoming.map((song, index) => {
          const artist = song.artists.map((item) => item.name).join(', ');
          return (
            <li key={`${song.id}-${index}`} className="truncate text-body">
              {song.title}
              {artist && <span className="text-muted-foreground"> · {artist}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
