import { useQuery } from '@tanstack/react-query';
import { Heart, Pause, Play } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { toQueueFromMixed, TrackList } from '@/components/TrackList';
import { FormError } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { catalogKeys, libraryApi } from '@/lib/catalog';
import { formatDuration } from '@/lib/format';
import { useLikedIds } from '@/lib/likes';
import { currentTrack, usePlayer } from '@/player/store';

export function LikedPage() {
  const likes = useQuery({ queryKey: catalogKeys.likes, queryFn: libraryApi.likes });
  // Hide songs unliked on this page right away, before the list refetches.
  const likedIds = useLikedIds();
  const items = toQueueFromMixed(likes.data ?? []).filter((t) => likedIds.has(t.id));
  const { nowId, playing, playTracks, togglePlay } = usePlayer(
    useShallow((s) => ({ nowId: currentTrack(s)?.id, playing: s.playing, playTracks: s.playTracks, togglePlay: s.togglePlay })),
  );
  const playingHere = playing && items.some((t) => t.id === nowId);
  const totalMs = items.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);

  return (
    <section className="grid gap-8">
      <header className="flex flex-wrap items-end gap-6">
        <div className="flex size-48 items-center justify-center rounded-md bg-gradient-to-br from-indigo-600 to-sky-300 shadow-2xl sm:size-56">
          <Heart className="size-20 fill-current text-white" aria-hidden />
        </div>
        <div className="grid gap-2">
          <p className="text-sm font-semibold">Playlist</p>
          <h1 className="text-4xl font-bold sm:text-6xl">Liked Songs</h1>
          {likes.data && (
            <p className="text-sm text-muted">
              {items.length} {items.length === 1 ? 'song' : 'songs'}
              {items.length > 0 && `, ${formatDuration(totalMs)}`}
            </p>
          )}
        </div>
      </header>

      {likes.isPending && <Spinner label="Loading liked songs" />}
      {likes.isError && <FormError message="Could not load your liked songs." />}
      {likes.data && items.length === 0 && (
        <p className="text-muted">Songs you like appear here. Tap the heart next to any song.</p>
      )}
      {items.length > 0 && (
        <>
          <div>
            <button
              type="button"
              aria-label={playingHere ? 'Pause Liked Songs' : 'Play Liked Songs'}
              onClick={() => (playingHere ? togglePlay() : playTracks(items, 0))}
              className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
            >
              {playingHere ? <Pause className="size-6 fill-current" aria-hidden /> : <Play className="ml-1 size-6 fill-current" aria-hidden />}
            </button>
          </div>
          <TrackList items={items} variant="mixed" label="Liked Songs" />
        </>
      )}
    </section>
  );
}
