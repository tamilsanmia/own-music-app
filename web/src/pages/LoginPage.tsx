import { Music2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useAuth } from '@/auth/AuthProvider';
import type { FromState } from '@/auth/guards';
import { Button } from '@/components/ui/button';
import { Field, FormError, Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ApiError } from '@/lib/api';

export function LoginPage() {
  const { status, login } = useAuth();
  const location = useLocation();
  const from = (location.state as FromState | null)?.from;
  const target = from ? `${from.pathname}${from.search ?? ''}` : '/';

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }
  if (status === 'authenticated') return <Navigate to={target} replace />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    setSubmitting(true);
    try {
      // On success the auth status changes and the <Navigate> above sends the user on.
      await login(String(form.get('email')), String(form.get('password')));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Try again.');
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-surface-3 to-sidebar p-4">
      <div className="w-full max-w-sm rounded-lg bg-sidebar p-8 shadow-2xl sm:p-10">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <Music2 className="size-10 text-primary" aria-hidden />
          <h1 className="text-2xl font-bold">Log in to Music</h1>
          <p className="text-sm text-muted">Accounts are invite-only. Ask the admin for one.</p>
        </div>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field label="Email" htmlFor="email">
            <Input id="email" name="email" type="email" autoComplete="username" required autoFocus />
          </Field>
          <Field label="Password" htmlFor="password">
            <Input id="password" name="password" type="password" autoComplete="current-password" required />
          </Field>
          <FormError message={error} />
          <Button type="submit" size="lg" className="mt-2" disabled={submitting}>
            {submitting ? 'Logging in…' : 'Log in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
