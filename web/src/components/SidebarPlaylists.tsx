import { Plus } from 'lucide-react';
import { NavLink, useNavigate } from 'react-router';
import { useCreatePlaylist, usePlaylists } from '@/lib/playlists';
import { cn } from '@/lib/utils';
import { PlaylistCover } from './PlaylistCover';

/** "Your playlists" in the sidebar, with a button to start a new one. */
export function SidebarPlaylists() {
  const playlists = usePlaylists();
  const create = useCreatePlaylist();
  const navigate = useNavigate();

  return (
    <nav aria-label="Your playlists" className="flex min-h-0 flex-1 flex-col rounded-lg bg-background p-3">
      <div className="flex items-center justify-between px-3 pb-2">
        <p className="text-xs font-bold uppercase tracking-wider text-muted">Playlists</p>
        <button
          type="button"
          aria-label="New playlist"
          disabled={create.isPending}
          onClick={() => create.mutate(undefined, { onSuccess: (p) => navigate(`/playlists/${p.id}`) })}
          className="flex size-7 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </div>
      <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto">
        {playlists.data?.length === 0 && <li className="px-3 text-xs text-muted">Create your first playlist with +</li>}
        {playlists.data?.map((p) => (
          <li key={p.id}>
            <NavLink
              to={`/playlists/${p.id}`}
              className={({ isActive }) =>
                cn('flex items-center gap-3 rounded-md px-2 py-1.5 text-sm', isActive ? 'bg-surface-3' : 'hover:bg-surface-2')
              }
            >
              <PlaylistCover covers={p.covers} className="size-9 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{p.name}</span>
                <span className="block text-xs text-muted">
                  {p.trackCount} {p.trackCount === 1 ? 'song' : 'songs'}
                </span>
              </span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
