import { Link } from 'react-router';
import type { Artist } from '@/lib/catalog';
import { Artwork } from './Artwork';

export function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <li className="relative grid gap-3 rounded-lg bg-surface p-3 transition-colors hover:bg-surface-3">
      <Artwork image={artist.image} alt="" round className="w-full shadow-lg" />
      <div className="min-w-0">
        <Link to={`/artists/${artist.id}`} className="block truncate font-semibold after:absolute after:inset-0">
          {artist.name}
        </Link>
        <p className="text-sm text-muted">Artist</p>
      </div>
    </li>
  );
}
