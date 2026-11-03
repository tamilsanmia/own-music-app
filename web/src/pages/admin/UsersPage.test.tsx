import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { db } from '../../../test/mock-api';
import { renderApp } from '../../../test/render';

describe('UsersPage', () => {
  it('lists users with role and status', async () => {
    renderApp('/admin/users', { as: 'admin' });
    const row = (await screen.findByText('ann@music.test')).closest('tr')!;
    expect(within(row).getByText('Listener')).toBeInTheDocument();
    expect(within(row).getByText('Active')).toBeInTheDocument();
    // The admin can't deactivate themselves.
    const adminRow = within(screen.getByRole('table')).getByText('admin@music.test').closest('tr')!;
    expect(within(adminRow).queryByRole('button', { name: /deactivate/i })).not.toBeInTheDocument();
  });

  it('creates a listener and shows them in the list', async () => {
    const { user } = renderApp('/admin/users', { as: 'admin' });
    await user.click(await screen.findByRole('button', { name: 'Add listener' }));

    const dialog = await screen.findByRole('dialog', { name: 'Add listener' });
    await user.type(within(dialog).getByLabelText('Name'), 'Bob');
    await user.type(within(dialog).getByLabelText('Email'), 'Bob@Music.test');
    await user.click(within(dialog).getByRole('button', { name: 'Generate' }));
    const password = (within(dialog).getByLabelText('Password') as HTMLInputElement).value;
    expect(password).toHaveLength(14);
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('bob@music.test')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(db.calls.createUser).toEqual([{ email: 'Bob@Music.test', displayName: 'Bob', password }]);
  });

  it('shows a duplicate-email error and keeps the dialog open', async () => {
    const { user } = renderApp('/admin/users', { as: 'admin' });
    await user.click(await screen.findByRole('button', { name: 'Add listener' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add listener' });
    await user.type(within(dialog).getByLabelText('Name'), 'Ann again');
    await user.type(within(dialog).getByLabelText('Email'), 'ann@music.test');
    await user.type(within(dialog).getByLabelText('Password'), 'some-password');
    await user.click(within(dialog).getByRole('button', { name: 'Create account' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already exists');
    expect(screen.getByRole('dialog', { name: 'Add listener' })).toBeInTheDocument();
  });

  it('deactivates and reactivates a listener', async () => {
    const { user } = renderApp('/admin/users', { as: 'admin' });
    await user.click(await screen.findByRole('button', { name: 'Deactivate ann@music.test' }));
    const row = () => screen.getByText('ann@music.test').closest('tr')!;
    expect(await within(row()).findByText('Deactivated')).toBeInTheDocument();
    expect(db.users.find((u) => u.id === 'u-ann')!.isActive).toBe(false);

    await user.click(within(row()).getByRole('button', { name: 'Activate ann@music.test' }));
    expect(await within(row()).findByText('Active')).toBeInTheDocument();
  });

  it('resets a password', async () => {
    const { user } = renderApp('/admin/users', { as: 'admin' });
    await user.click(await screen.findByRole('button', { name: 'Reset password for ann@music.test' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reset password' });
    await user.type(within(dialog).getByLabelText('New password'), 'fresh-password');
    await user.click(within(dialog).getByRole('button', { name: 'Reset password' }));

    await expect.poll(() => db.users.find((u) => u.id === 'u-ann')!.password).toBe('fresh-password');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
