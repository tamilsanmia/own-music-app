import { AudioLines, Pause, Play } from 'lucide-react';
import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import type { Album, Track, TrackWithAlbum } from '@/lib/catalog';
import { formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import { currentTrack, usePlayer, type QueueTrack } from '@/player/store';
import { Artwork } from './Artwork';
import { LikeButton } from './LikeButton';
import { TrackMenu } from './TrackMenu';

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

export type TrackListVariant = 'album' | 'mixed';

export interface TrackRowProps {
  /** The whole list, so clicking a row can play from there. */
  items: QueueTrack[];
  index: number;
  variant: TrackListVariant;
  albumArtistId?: string;
  /** Extra items for the "⋯" menu (e.g. playlist actions). */
  menuExtra?: ReactNode;
  /** Shown before the number, e.g. a drag handle. */
  leading?: ReactNode;
  style?: CSSProperties;
  className?: string;
}

/**
 * One track row. Clicking the number/play button plays `items` from this row; clicking the
 * playing row pauses. "album" rows show the track number (and the artist only when it differs
 * from the album's); "mixed" rows show position, cover, artist and album.
 */
export const TrackRow = forwardRef<HTMLLIElement, TrackRowProps>(function TrackRow(
  { items, index, variant, albumArtistId, menuExtra, leading, style, className },
  ref,
) {
  const t = items[index];
  const { isCurrent, playing, playTracks, togglePlay } = usePlayer(
    useShallow((s) => ({ isCurrent: currentTrack(s)?.id === t.id, playing: s.playing, playTracks: s.playTracks, togglePlay: s.togglePlay })),
  );
  const mixed = variant === 'mixed';
  const action = isCurrent && playing ? 'Pause' : 'Play';
  const showArtist = mixed || t.artist.id !== albumArtistId;

  return (
    <li ref={ref} style={style} className={className}>
      <div
        className={cn(
          'group grid items-center gap-4 rounded-md px-4 py-2 hover:bg-surface-3',
          mixed
            ? leading
              ? 'grid-cols-[3.75rem_1fr_minmax(0,14rem)_auto_auto_auto]'
              : 'grid-cols-[2.5rem_1fr_minmax(0,14rem)_auto_auto_auto]'
            : 'grid-cols-[2.5rem_1fr_auto_auto_auto]',
          leading && 'pl-1',
        )}
      >
        <div className="flex items-center">
          {leading}
          <button
            type="button"
            aria-label={`${action} ${t.title}`}
            onClick={() => (isCurrent ? togglePlay() : playTracks(items, index))}
            className="flex size-6 items-center justify-center justify-self-center text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className={cn('tabular-nums group-hover:hidden', isCurrent && 'text-primary')}>
              {isCurrent && playing ? <AudioLines className="size-4" aria-hidden /> : mixed ? index + 1 : (t.trackNumber ?? index + 1)}
            </span>
            <span className="hidden text-foreground group-hover:inline">
              {isCurrent && playing ? <Pause className="size-4 fill-current" aria-hidden /> : <Play className="size-4 fill-current" aria-hidden />}
            </span>
          </button>
        </div>
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
        <TrackMenu track={t} extra={menuExtra} className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100" />
      </div>
    </li>
  );
});

export function TrackList({
  items,
  variant,
  albumArtistId,
  label = 'Tracks',
}: {
  items: QueueTrack[];
  variant: TrackListVariant;
  albumArtistId?: string;
  label?: string;
}) {
  return (
    <ol aria-label={label} className="grid">
      {items.map((t, i) => (
        <TrackRow key={`${t.id}-${i}`} items={items} index={i} variant={variant} albumArtistId={albumArtistId} />
      ))}
    </ol>
  );
}
