import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { authApi, onSessionExpired, refreshSession, setAccessToken, type User } from '@/lib/api';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: User | null;
  login(email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<{ status: Status; user: User | null }>({
    status: 'loading',
    user: null,
  });

  useEffect(() => {
    let cancelled = false;
    // Restore the session from the refresh cookie, if there is one.
    refreshSession().then(
      (s) => !cancelled && setState({ status: 'authenticated', user: s.user }),
      () => !cancelled && setState({ status: 'anonymous', user: null }),
    );
    const off = onSessionExpired(() => {
      setAccessToken(null);
      queryClient.clear();
      setState({ status: 'anonymous', user: null });
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [queryClient]);

  const login = useCallback(async (email: string, password: string) => {
    const session = await authApi.login(email, password);
    setState({ status: 'authenticated', user: session.user });
    return session.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      queryClient.clear();
      setState({ status: 'anonymous', user: null });
    }
  }, [queryClient]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const session = await authApi.changePassword(currentPassword, newPassword);
    setState({ status: 'authenticated', user: session.user });
  }, []);

  const value = useMemo(
    () => ({ ...state, login, logout, changePassword }),
    [state, login, logout, changePassword],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
