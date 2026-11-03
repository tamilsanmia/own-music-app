import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { AlbumCard, AlbumGrid } from '@/components/AlbumCard';
import { FormError } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api';
import { catalogApi, catalogKeys, libraryApi } from '@/lib/catalog';
import { RecentlyPlayed } from '@/components/RecentlyPlayed';

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function HomePage() {
  const { user } = useAuth();
  const home = useQuery({ queryKey: catalogKeys.home, queryFn: catalogApi.home });
  const recent = useQuery({ queryKey: catalogKeys.recent, queryFn: libraryApi.recent });

  return (
    <section className="grid gap-8">
      <h1 className="text-3xl font-bold">
        {greeting(new Date().getHours())}, {user?.displayName}
      </h1>

      {recent.data && recent.data.items.length > 0 && <RecentlyPlayed tracks={recent.data.items.slice(0, 8)} />}

      <div className="grid gap-4">
        <h2 className="text-xl font-bold">New albums</h2>
        {home.isPending && <Spinner label="Loading albums" />}
        {home.isError && (
          <FormError message={home.error instanceof ApiError ? home.error.message : 'Could not load albums.'} />
        )}
        {home.data?.newAlbums.length === 0 && (
          <p className="text-muted">Your library is empty for now. Albums appear here once the admin uploads music.</p>
        )}
        {home.data && home.data.newAlbums.length > 0 && (
          <AlbumGrid label="New albums">
            {home.data.newAlbums.map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </AlbumGrid>
        )}
      </div>
    </section>
  );
}
