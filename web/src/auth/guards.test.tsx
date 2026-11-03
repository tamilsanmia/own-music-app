import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderApp } from '../../test/render';

describe('route guards', () => {
  it('sends a logged-out visitor to /login, then back to the page they asked for', async () => {
    const { user } = renderApp('/account');
    expect(await screen.findByRole('heading', { name: 'Log in to Music' })).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email'), 'ann@music.test');
    await user.type(screen.getByLabelText('Password'), 'ann-pass-1');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
  });

  it('restores the session from the refresh cookie on load', async () => {
    renderApp('/account', { as: 'listener' });
    expect(await screen.findByRole('heading', { name: 'Account' })).toBeInTheDocument();
  });

  it('hides the admin section from listeners and redirects /admin/users home', async () => {
    renderApp('/admin/users', { as: 'listener' });
    expect(await screen.findByRole('heading', { name: /, Ann$/ })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Admin' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('shows the admin section and Users page to admins', async () => {
    renderApp('/admin/users', { as: 'admin' });
    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();
  });

  it('logging out returns to the login page', async () => {
    const { user } = renderApp('/', { as: 'listener' });
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('heading', { name: 'Log in to Music' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Ann')).not.toBeInTheDocument());
  });
});
