import { AudioLines, Pause, Play } from 'lucide-react';
import { Link } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import type { Album, Track, TrackWithAlbum } from '@/lib/catalog';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { currentTrack, usePlayer, type QueueTrack } from '@/player/store';
import { Artwork } from './Artwork';
import { LikeButton } from './LikeButton';

export function toQueue(album: Album, tracks: Track[]): QueueTrack[] {
  return tracks.map((t) => ({
    id: t.id,
    title: t.title,
    trackNumber: t.trackNumber,
    durationMs: t.durationMs,
    artist: t.artist,
    album: { id: album.id, title: album.title, cover: album.cover },
  }));
}

export function toQueueFromMixed(tracks: TrackWithAlbum[]): QueueTrack[] {
  return tracks.map((t) => ({ id: t.id, title: t.title, durationMs: t.durationMs, artist: t.artist, album: t.album }));
}

/**
 * A list of tracks. Clicking a row plays the list from there; clicking the playing one pauses.
 * "album" shows track numbers (and the artist only when it differs from the album's);
 * "mixed" shows position, cover, artist and album, for search results and playlists.
 */
export function TrackList({
  items,
  variant,
  albumArtistId,
  label = 'Tracks',
}: {
  items: QueueTrack[];
  variant: 'album' | 'mixed';
  albumArtistId?: string;
  label?: string;
}) {
  const { nowId, playing, playTracks, togglePlay } = usePlayer(
    useShallow((s) => ({ nowId: currentTrack(s)?.id, playing: s.playing, playTracks: s.playTracks, togglePlay: s.togglePlay })),
  );
  const mixed = variant === 'mixed';

  return (
    <ol aria-label={label} className="grid">
      {items.map((t, i) => {
        const isCurrent = t.id === nowId;
        const action = isCurrent && playing ? 'Pause' : 'Play';
        const showArtist = mixed || t.artist.id !== albumArtistId;
        return (
          <li key={`${t.id}-${i}`}>
            <div
              className={cn(
                'group grid items-center gap-4 rounded-md px-4 py-2 hover:bg-surface-3',
                mixed ? 'grid-cols-[2.5rem_1fr_minmax(0,14rem)_auto_auto]' : 'grid-cols-[2.5rem_1fr_auto_auto]',
              )}
            >
              <button
                type="button"
                aria-label={`${action} ${t.title}`}
                onClick={() => (isCurrent ? togglePlay() : playTracks(items, i))}
                className="flex size-6 items-center justify-center justify-self-center text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span className={cn('tabular-nums group-hover:hidden', isCurrent && 'text-primary')}>
                  {isCurrent && playing ? <AudioLines className="size-4" aria-hidden /> : mixed ? i + 1 : (t.trackNumber ?? i + 1)}
                </span>
                <span className="hidden text-foreground group-hover:inline">
                  {isCurrent && playing ? <Pause className="size-4 fill-current" aria-hidden /> : <Play className="size-4 fill-current" aria-hidden />}
                </span>
              </button>
              <div className="flex min-w-0 items-center gap-3">
                {mixed && <Artwork image={t.album.cover} alt="" className="size-10 shrink-0" />}
                <div className="min-w-0">
                  <p className={cn('truncate font-semibold', isCurrent ? 'text-primary' : 'text-foreground')}>{t.title}</p>
                  {showArtist && (
                    <Link to={`/artists/${t.artist.id}`} className="block truncate text-sm text-muted hover:text-foreground hover:underline">
                      {t.artist.name}
                    </Link>
                  )}
                </div>
              </div>
              {mixed && (
                <Link to={`/albums/${t.album.id}`} className="truncate text-sm text-muted hover:text-foreground hover:underline">
                  {t.album.title}
                </Link>
              )}
              <LikeButton trackId={t.id} title={t.title} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 aria-pressed:opacity-100" />
              <span className="w-12 text-right text-sm tabular-nums text-muted">{formatDuration(t.durationMs)}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
