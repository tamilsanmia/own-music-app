import { Navigate, Outlet, useLocation } from 'react-router';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from './AuthProvider';

export interface FromState {
  from?: { pathname: string; search?: string };
}

/** Logged-in users only. Others go to /login and come back here afterwards. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Spinner label="Loading" />
      </div>
    );
  }
  if (status === 'anonymous') {
    const state: FromState = { from: { pathname: location.pathname, search: location.search } };
    return <Navigate to="/login" replace state={state} />;
  }
  return <Outlet />;
}

/** Admins only. Listeners are sent home. The server enforces this too. */
export function RequireAdmin() {
  const { user } = useAuth();
  if (user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <Outlet />;
}
