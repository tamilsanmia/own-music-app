import { AudioLines, Pause, Play } from 'lucide-react';
import { Link } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import type { Album, Track } from '@/lib/catalog';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { currentTrack, usePlayer, type QueueTrack } from '@/player/store';

export function toQueue(album: Album, tracks: Track[]): QueueTrack[] {
  return tracks.map((t) => ({
    id: t.id,
    title: t.title,
    durationMs: t.durationMs,
    artist: t.artist,
    album: { id: album.id, title: album.title, cover: album.cover },
  }));
}

/** Album track list. Clicking a row plays the album from that track; clicking the playing one pauses. */
export function TrackList({ album, tracks }: { album: Album; tracks: Track[] }) {
  const { nowId, playing, playTracks, togglePlay } = usePlayer(
    useShallow((s) => ({ nowId: currentTrack(s)?.id, playing: s.playing, playTracks: s.playTracks, togglePlay: s.togglePlay })),
  );

  return (
    <ol aria-label="Tracks" className="grid">
      {tracks.map((t, i) => {
        const isCurrent = t.id === nowId;
        const action = isCurrent && playing ? 'Pause' : 'Play';
        return (
          <li key={t.id}>
            <div
              className={cn(
                'group grid grid-cols-[2.5rem_1fr_auto] items-center gap-4 rounded-md px-4 py-2 hover:bg-surface-3',
                isCurrent && 'text-primary',
              )}
            >
              <button
                type="button"
                aria-label={`${action} ${t.title}`}
                onClick={() => (isCurrent ? togglePlay() : playTracks(toQueue(album, tracks), i))}
                className="flex size-6 items-center justify-center justify-self-center text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className={cn('tabular-nums group-hover:hidden', isCurrent && 'text-primary')}>
                  {isCurrent && playing ? <AudioLines className="size-4" aria-hidden /> : t.trackNumber}
                </span>
                <span className="hidden text-foreground group-hover:inline">
                  {isCurrent && playing ? <Pause className="size-4 fill-current" aria-hidden /> : <Play className="size-4 fill-current" aria-hidden />}
                </span>
              </button>
              <div className="min-w-0">
                <p className={cn('truncate font-semibold', !isCurrent && 'text-foreground')}>{t.title}</p>
                {t.artist.id !== album.artist.id && (
                  <Link to={`/artists/${t.artist.id}`} className="truncate text-sm text-muted hover:underline">
                    {t.artist.name}
                  </Link>
                )}
              </div>
              <span className="text-sm tabular-nums text-muted">{formatDuration(t.durationMs)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
