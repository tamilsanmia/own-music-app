import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from '@/auth/AuthProvider';
import { RequireAdmin, RequireAuth } from '@/auth/guards';
import { AppLayout } from '@/components/AppLayout';
import { ApiError } from '@/lib/api';
import { AccountPage } from '@/pages/AccountPage';
import { HomePage } from '@/pages/HomePage';
import { LoginPage } from '@/pages/LoginPage';
import { NotFoundPage } from '@/pages/NotFoundPage';

// Admin pages are split into their own chunks, so listeners never download them.
const UsersPage = lazy(() => import('@/pages/admin/UsersPage'));
const ArtistsPage = lazy(() => import('@/pages/admin/ArtistsPage'));
const ArtistPage = lazy(() => import('@/pages/admin/ArtistPage'));
const AlbumsPage = lazy(() => import('@/pages/admin/AlbumsPage'));
const AlbumPage = lazy(() => import('@/pages/admin/AlbumPage'));

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Retrying 4xx errors never helps.
        retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      },
    },
  });
}

/** Everything except the router, so tests can supply a MemoryRouter. */
export function AppProviders({ queryClient, children }: { queryClient: QueryClient; children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="admin" element={<RequireAdmin />}>
            <Route index element={<Navigate to="albums" replace />} />
            <Route path="users" element={<UsersPage />} />
            <Route path="artists" element={<ArtistsPage />} />
            <Route path="artists/:id" element={<ArtistPage />} />
            <Route path="albums" element={<AlbumsPage />} />
            <Route path="albums/:id" element={<AlbumPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
