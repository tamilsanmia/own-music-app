import { Disc3, Heart, Home, LogOut, Mic2, Music2, Search, UserCog, Users } from 'lucide-react';
import { lazy, Suspense, type ComponentType } from 'react';
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import { Spinner } from '@/components/ui/spinner';
import { PlayerBar, usePlaybackEngine } from '@/player/PlayerBar';
import { SidebarPlaylists } from './SidebarPlaylists';
import { Toaster } from './Toaster';
import { cn } from '@/lib/utils';

function NavItem({ to, icon: Icon, label, end }: { to: string; icon: ComponentType<{ className?: string }>; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-4 rounded-md px-3 py-2 text-sm font-semibold transition-colors',
          isActive ? 'bg-surface-3 text-foreground' : 'text-muted hover:text-foreground',
        )
      }
    >
      <Icon className="size-5" />
      {label}
    </NavLink>
  );
}

// Loaded only for admins, so the upload code stays out of the listener bundle.
const UploadIndicator = lazy(() => import('@/admin/UploadIndicator'));

export function AppLayout() {
  const { user, logout } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  usePlaybackEngine();

  return (
    <div className="flex h-screen flex-col gap-2 bg-sidebar p-2">
      <div className="flex min-h-0 flex-1 gap-2">
      <aside className="flex w-60 shrink-0 flex-col gap-2">
        <nav aria-label="Main" className="rounded-lg bg-background p-3">
          <div className="mb-3 flex items-center gap-2 px-3 py-2 text-lg font-bold">
            <Music2 className="size-6 text-primary" aria-hidden />
            Music
          </div>
          <NavItem to="/" end icon={Home} label="Home" />
          <NavItem to="/search" icon={Search} label="Search" />
          <NavItem to="/liked" icon={Heart} label="Liked Songs" />
        </nav>

        <SidebarPlaylists />

        {isAdmin && (
          <nav aria-label="Admin" className="rounded-lg bg-background p-3">
            <p className="px-3 pb-2 text-xs font-bold uppercase tracking-wider text-muted">Admin</p>
            <NavItem to="/admin/albums" icon={Disc3} label="Albums" />
            <NavItem to="/admin/artists" icon={Mic2} label="Artists" />
            <NavItem to="/admin/users" icon={Users} label="Users" />
            <Suspense fallback={null}>
              <UploadIndicator />
            </Suspense>
          </nav>
        )}

        <div className="rounded-lg bg-background p-3">
          <p className="truncate px-3 pb-1 text-sm font-semibold" title={user?.email}>
            {user?.displayName}
          </p>
          <p className="truncate px-3 pb-2 text-xs text-muted">{user?.email}</p>
          <NavItem to="/account" icon={UserCog} label="Account" />
          <button
            type="button"
            onClick={() => void logout()}
            className="flex w-full items-center gap-4 rounded-md px-3 py-2 text-sm font-semibold text-muted transition-colors hover:text-foreground"
          >
            <LogOut className="size-5" />
            Log out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto rounded-lg bg-gradient-to-b from-surface-3 to-background to-[18rem]">
        <div className="mx-auto max-w-6xl p-8">
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
      </div>
      <PlayerBar />
      <Toaster />
    </div>
  );
}
