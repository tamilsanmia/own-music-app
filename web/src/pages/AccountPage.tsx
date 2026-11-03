import { useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FormError, Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';

export function AccountPage() {
  const { user, changePassword } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    const next = String(form.get('newPassword'));
    setDone(false);
    if (next.length < 8) return setError('The new password must be at least 8 characters.');
    if (next !== form.get('confirmPassword')) return setError('The new passwords do not match.');

    setError(null);
    setSubmitting(true);
    try {
      await changePassword(String(form.get('currentPassword')), next);
      formEl.reset();
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="grid max-w-lg gap-6">
      <div>
        <h1 className="text-3xl font-bold">Account</h1>
        <p className="mt-2 text-muted">
          {user?.displayName} · {user?.email}
        </p>
      </div>
      <Card>
        <h2 className="mb-4 text-lg font-bold">Change password</h2>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <Field label="Current password" htmlFor="currentPassword">
            <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
          </Field>
          <Field label="New password" htmlFor="newPassword" hint="At least 8 characters.">
            <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required />
          </Field>
          <Field label="Confirm new password" htmlFor="confirmPassword">
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
          </Field>
          <FormError message={error} />
          {done && (
            <p role="status" className="text-sm text-primary">
              Password changed. You've been logged out on your other devices.
            </p>
          )}
          <Button type="submit" className="justify-self-start" disabled={submitting}>
            {submitting ? 'Saving…' : 'Change password'}
          </Button>
        </form>
      </Card>
    </section>
  );
}
