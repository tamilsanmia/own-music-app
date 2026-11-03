import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, UserPlus, Wand2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FormError, Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { ApiError, usersApi, type User } from '@/lib/api';
import { generatePassword } from '@/lib/utils';

const USERS_KEY = ['admin', 'users'] as const;

function errorText(err: unknown): string | null {
  if (!err) return null;
  return err instanceof ApiError ? err.message : 'Could not reach the server. Try again.';
}

/** Password input with a "Generate" button. Shown in plain text so the admin can pass it on. */
function PasswordField({ id, label }: { id: string; label: string }) {
  const [value, setValue] = useState('');
  return (
    <Field label={label} htmlFor={id} hint="At least 8 characters. Share it with the listener privately.">
      <div className="flex gap-2">
        <Input
          id={id}
          name="password"
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          required
          minLength={8}
        />
        <Button type="button" variant="secondary" onClick={() => setValue(generatePassword())}>
          <Wand2 aria-hidden />
          Generate
        </Button>
      </div>
    </Field>
  );
}

function CreateUserDialog() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const create = useMutation({
    mutationFn: usersApi.create,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS_KEY });
      setOpen(false);
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    create.mutate({
      email: String(form.get('email')).trim(),
      displayName: String(form.get('displayName')).trim(),
      password: String(form.get('password')),
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) create.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden />
          Add listener
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add listener</DialogTitle>
          <DialogDescription>They log in with this email and password.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <Field label="Name" htmlFor="new-displayName">
            <Input id="new-displayName" name="displayName" required maxLength={100} />
          </Field>
          <Field label="Email" htmlFor="new-email">
            <Input id="new-email" name="email" type="email" autoComplete="off" required />
          </Field>
          <PasswordField id="new-password" label="Password" />
          <FormError message={errorText(create.error)} />
          <DialogFooter>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create account'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ user, onClose }: { user: User; onClose(): void }) {
  const queryClient = useQueryClient();
  const reset = useMutation({
    mutationFn: (password: string) => usersApi.update(user.id, { password }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS_KEY });
      onClose();
    },
  });

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    reset.mutate(String(new FormData(e.currentTarget).get('password')));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Set a new password for {user.displayName}. They are logged out on all their devices.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid gap-4">
          <PasswordField id="reset-password" label="New password" />
          <FormError message={errorText(reset.error)} />
          <DialogFooter>
            <Button type="submit" disabled={reset.isPending}>
              {reset.isPending ? 'Saving…' : 'Reset password'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UserRow({ user, isSelf, onResetPassword }: { user: User; isSelf: boolean; onResetPassword(): void }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: () => usersApi.update(user.id, { isActive: !user.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_KEY }),
  });

  return (
    <tr className="border-t border-border">
      <td className="px-4 py-3 font-semibold">
        {user.displayName}
        {isSelf && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}
      </td>
      <td className="px-4 py-3 text-muted">{user.email}</td>
      <td className="px-4 py-3">
        <Badge variant="outline">{user.role === 'ADMIN' ? 'Admin' : 'Listener'}</Badge>
      </td>
      <td className="px-4 py-3">
        {user.isActive ? <Badge variant="success">Active</Badge> : <Badge variant="danger">Deactivated</Badge>}
      </td>
      <td className="px-4 py-3 text-muted">{new Date(user.createdAt).toLocaleDateString()}</td>
      <td className="px-4 py-3">
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onResetPassword} aria-label={`Reset password for ${user.email}`}>
            <KeyRound aria-hidden />
            Reset password
          </Button>
          {!isSelf && (
            <Button
              size="sm"
              variant={user.isActive ? 'outline' : 'secondary'}
              disabled={toggle.isPending}
              onClick={() => toggle.mutate()}
              aria-label={`${user.isActive ? 'Deactivate' : 'Activate'} ${user.email}`}
            >
              {user.isActive ? 'Deactivate' : 'Activate'}
            </Button>
          )}
        </div>
        {toggle.error && <p className="mt-1 text-right text-xs text-danger">{errorText(toggle.error)}</p>}
      </td>
    </tr>
  );
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const users = useQuery({ queryKey: USERS_KEY, queryFn: usersApi.list });
  const [resetting, setResetting] = useState<User | null>(null);

  return (
    <section className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Users</h1>
          <p className="mt-2 text-muted">Only people you add here can log in.</p>
        </div>
        <CreateUserDialog />
      </div>

      {users.isPending && <Spinner label="Loading users" />}
      {users.isError && <FormError message={errorText(users.error)} />}
      {users.data && (
        <div className="overflow-x-auto rounded-lg bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-wider text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">Name</th>
                <th className="px-4 py-3 font-semibold">Email</th>
                <th className="px-4 py-3 font-semibold">Role</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Added</th>
                <th className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.data.map((u) => (
                <UserRow key={u.id} user={u} isSelf={u.id === me?.id} onResetPassword={() => setResetting(u)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {resetting && <ResetPasswordDialog user={resetting} onClose={() => setResetting(null)} />}
    </section>
  );
}
