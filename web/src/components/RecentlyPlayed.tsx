import { Pause, Play } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { TrackWithAlbum } from '@/lib/catalog';
import { cn } from '@/lib/utils';
import { currentTrack, usePlayer } from '@/player/store';
import { Artwork } from './Artwork';
import { toQueueFromMixed } from './TrackList';

/** Compact tiles of recently played songs. Clicking one plays the row from there. */
export function RecentlyPlayed({ tracks }: { tracks: TrackWithAlbum[] }) {
  const { nowId, playing, playTracks, togglePlay } = usePlayer(
    useShallow((s) => ({ nowId: currentTrack(s)?.id, playing: s.playing, playTracks: s.playTracks, togglePlay: s.togglePlay })),
  );
  const queue = toQueueFromMixed(tracks);

  return (
    <div className="grid gap-4">
      <h2 className="text-xl font-bold">Recently played</h2>
      <ul aria-label="Recently played" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {tracks.map((t, i) => {
          const isCurrent = t.id === nowId;
          const action = isCurrent && playing ? 'Pause' : 'Play';
          return (
            <li key={t.id}>
              <button
                type="button"
                aria-label={`${action} ${t.title}`}
                onClick={() => (isCurrent ? togglePlay() : playTracks(queue, i))}
                className="group flex w-full items-center gap-3 overflow-hidden rounded-md bg-surface-3/60 pr-3 text-left transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <Artwork image={t.album.cover} alt="" className="size-14 shrink-0 rounded-none" />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-sm font-semibold', isCurrent && 'text-primary')}>{t.title}</span>
                  <span className="block truncate text-xs text-muted">{t.artist.name}</span>
                </span>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground opacity-0 shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                  {isCurrent && playing ? <Pause className="size-4 fill-current" aria-hidden /> : <Play className="ml-0.5 size-4 fill-current" aria-hidden />}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
