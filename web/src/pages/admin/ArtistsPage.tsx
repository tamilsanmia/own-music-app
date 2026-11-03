import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { adminKeys, artistsApi } from '@/admin/catalogApi';
import { Artwork, PageHeader } from '@/admin/components';
import { errorText, NewArtistDialog } from '@/admin/dialogs';
import { FormError } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

export default function ArtistsPage() {
  const artists = useQuery({ queryKey: adminKeys.artists, queryFn: artistsApi.list });

  return (
    <section className="grid gap-6">
      <PageHeader title="Artists" subtitle="Add an artist, then their albums and tracks.">
        <NewArtistDialog />
      </PageHeader>

      {artists.isPending && <Spinner label="Loading artists" />}
      {artists.isError && <FormError message={errorText(artists.error)} />}
      {artists.data?.items.length === 0 && <p className="text-muted">No artists yet.</p>}
      {artists.data && artists.data.items.length > 0 && (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-4">
          {artists.data.items.map((a) => (
            <li key={a.id}>
              <Link
                to={`/admin/artists/${a.id}`}
                className="grid gap-3 rounded-lg bg-surface p-4 transition-colors hover:bg-surface-2"
              >
                <Artwork image={a.image} alt={a.name} round className="w-full shadow-lg" />
                <div className="min-w-0">
                  <p className="truncate font-semibold">{a.name}</p>
                  <p className="text-xs text-muted">
                    {a.albumCount} {a.albumCount === 1 ? 'album' : 'albums'} · {a.trackCount}{' '}
                    {a.trackCount === 1 ? 'track' : 'tracks'}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
