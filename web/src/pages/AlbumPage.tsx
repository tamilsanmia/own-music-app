import { useQuery } from '@tanstack/react-query';
import { Pause, Play } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useShallow } from 'zustand/react/shallow';
import { Artwork } from '@/components/Artwork';
import { toQueue, TrackList } from '@/components/TrackList';
import { FormError } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api';
import { catalogApi, catalogKeys } from '@/lib/catalog';
import { formatDuration } from '@/lib/format';
import { currentTrack, usePlayer } from '@/player/store';

export function AlbumPage() {
  const { id = '' } = useParams();
  const album = useQuery({ queryKey: catalogKeys.album(id), queryFn: () => catalogApi.album(id) });
  const { nowAlbumId, playing, playTracks, togglePlay } = usePlayer(
    useShallow((s) => ({ nowAlbumId: currentTrack(s)?.album.id, playing: s.playing, playTracks: s.playTracks, togglePlay: s.togglePlay })),
  );

  if (album.isPending) return <Spinner label="Loading album" />;
  if (album.error instanceof ApiError && album.error.status === 404) {
    return <p className="text-muted">This album isn’t available.</p>;
  }
  if (album.isError) return <FormError message="Could not load this album." />;

  const a = album.data;
  const totalMs = a.tracks.reduce((sum, t) => sum + (t.durationMs ?? 0), 0);
  const isThisAlbum = nowAlbumId === a.id;

  return (
    <section className="grid gap-8">
      <header className="flex flex-wrap items-end gap-6">
        <Artwork image={a.cover} alt={`${a.title} cover`} size="large" className="w-48 shadow-2xl sm:w-56" />
        <div className="grid min-w-0 gap-2">
          <p className="text-sm font-semibold">Album</p>
          <h1 className="text-4xl font-bold break-words sm:text-5xl">{a.title}</h1>
          <p className="text-sm text-muted">
            <Link to={`/artists/${a.artist.id}`} className="font-semibold text-foreground hover:underline">
              {a.artist.name}
            </Link>
            {a.releaseYear && <> · {a.releaseYear}</>} · {a.tracks.length} {a.tracks.length === 1 ? 'song' : 'songs'},{' '}
            {formatDuration(totalMs)}
          </p>
        </div>
      </header>

      <div>
        <button
          type="button"
          aria-label={isThisAlbum && playing ? 'Pause album' : 'Play album'}
          onClick={() => (isThisAlbum ? togglePlay() : playTracks(toQueue(a, a.tracks), 0))}
          className="flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
        >
          {isThisAlbum && playing ? <Pause className="size-6 fill-current" aria-hidden /> : <Play className="ml-1 size-6 fill-current" aria-hidden />}
        </button>
      </div>

      <TrackList items={toQueue(a, a.tracks)} variant="album" albumArtistId={a.artist.id} />
    </section>
  );
}
