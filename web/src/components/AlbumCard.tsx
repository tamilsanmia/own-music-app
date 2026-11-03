import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { Album } from '@/lib/catalog';
import { Artwork } from './Artwork';

export function AlbumCard({ album, subtitle }: { album: Album; subtitle?: string }) {
  return (
    <li className="group relative grid gap-3 rounded-lg bg-surface p-3 transition-colors hover:bg-surface-3">
      <Artwork image={album.cover} alt="" className="w-full shadow-lg" />
      <div className="min-w-0">
        {/* The whole card is clickable through this link's ::after overlay. */}
        <Link to={`/albums/${album.id}`} className="block truncate font-semibold after:absolute after:inset-0">
          {album.title}
        </Link>
        <p className="truncate text-sm text-muted">{subtitle ?? album.artist.name}</p>
      </div>
    </li>
  );
}

export function AlbumGrid({ children, label }: { children: ReactNode; label: string }) {
  return (
    <ul aria-label={label} className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-4">
      {children}
    </ul>
  );
}
