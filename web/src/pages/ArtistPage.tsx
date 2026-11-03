import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { AlbumCard, AlbumGrid } from '@/components/AlbumCard';
import { Artwork } from '@/components/Artwork';
import { FormError } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api';
import { catalogApi, catalogKeys } from '@/lib/catalog';

export function ArtistPage() {
  const { id = '' } = useParams();
  const artist = useQuery({ queryKey: catalogKeys.artist(id), queryFn: () => catalogApi.artist(id) });

  if (artist.isPending) return <Spinner label="Loading artist" />;
  if (artist.error instanceof ApiError && artist.error.status === 404) {
    return <p className="text-muted">This artist isn’t available.</p>;
  }
  if (artist.isError) return <FormError message="Could not load this artist." />;
  const a = artist.data;

  return (
    <section className="grid gap-8">
      <header className="flex flex-wrap items-end gap-6">
        <Artwork image={a.image} alt={`Photo of ${a.name}`} round size="large" className="w-48 shadow-2xl sm:w-56" />
        <div className="grid min-w-0 gap-2">
          <p className="text-sm font-semibold">Artist</p>
          <h1 className="text-4xl font-bold break-words sm:text-6xl">{a.name}</h1>
        </div>
      </header>

      {a.bio && <p className="max-w-3xl whitespace-pre-line text-muted">{a.bio}</p>}

      <div className="grid gap-4">
        <h2 className="text-xl font-bold">Albums</h2>
        <AlbumGrid label="Albums">
          {a.albums.map((al) => (
            <AlbumCard key={al.id} album={al} subtitle={al.releaseYear ? String(al.releaseYear) : 'Album'} />
          ))}
        </AlbumGrid>
      </div>
    </section>
  );
}
