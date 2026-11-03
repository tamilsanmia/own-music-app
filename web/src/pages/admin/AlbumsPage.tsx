import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { adminKeys, albumsApi } from '@/admin/catalogApi';
import { Artwork, PageHeader } from '@/admin/components';
import { errorText, NewAlbumDialog } from '@/admin/dialogs';
import { FormError } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

export default function AlbumsPage() {
  const albums = useQuery({ queryKey: adminKeys.albums(), queryFn: () => albumsApi.list() });

  return (
    <section className="grid gap-6">
      <PageHeader title="Albums" subtitle="Newest first. Open an album to upload its tracks.">
        <NewAlbumDialog />
      </PageHeader>

      {albums.isPending && <Spinner label="Loading albums" />}
      {albums.isError && <FormError message={errorText(albums.error)} />}
      {albums.data?.items.length === 0 && <p className="text-muted">No albums yet. Create an artist first, then an album.</p>}
      {albums.data && albums.data.items.length > 0 && (
        <div className="overflow-x-auto rounded-lg bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Album</th>
                <th className="px-4 py-3 font-semibold">Artist</th>
                <th className="px-4 py-3 font-semibold">Year</th>
                <th className="px-4 py-3 font-semibold">Tracks</th>
              </tr>
            </thead>
            <tbody>
              {albums.data.items.map((a) => (
                <tr key={a.id} className="border-t border-border">
                  <td className="px-4 py-2">
                    <Link to={`/admin/albums/${a.id}`} className="flex items-center gap-3 font-semibold hover:underline">
                      <Artwork image={a.cover} alt="" className="size-10" />
                      {a.title}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted">
                    <Link to={`/admin/artists/${a.artist.id}`} className="hover:underline">
                      {a.artist.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-muted">{a.releaseYear ?? '–'}</td>
                  <td className="px-4 py-2 text-muted">{a.trackCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
