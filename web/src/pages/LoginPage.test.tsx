import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { db, server } from '../../test/mock-api';
import { renderApp } from '../../test/render';

describe('LoginPage', () => {
  it('logs in and lands on Home', async () => {
    const { user } = renderApp('/login');
    await user.type(await screen.findByLabelText('Email'), 'ann@music.test');
    await user.type(screen.getByLabelText('Password'), 'ann-pass-1');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('heading', { name: /, Ann$/ })).toBeInTheDocument();
    expect(db.session).toBe('u-ann');
  });

  it('shows the server error for wrong credentials and stays on the page', async () => {
    const { user } = renderApp('/login');
    await user.type(await screen.findByLabelText('Email'), 'ann@music.test');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    expect(screen.getByRole('heading', { name: 'Log in to Music' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled();
  });

  it('explains rate limiting', async () => {
    server.use(
      http.post('*/api/auth/login', () =>
        HttpResponse.json({ message: 'ThrottlerException: Too Many Requests' }, { status: 429 }),
      ),
    );
    const { user } = renderApp('/login');
    await user.type(await screen.findByLabelText('Email'), 'ann@music.test');
    await user.type(screen.getByLabelText('Password'), 'ann-pass-1');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
  });

  it('redirects an already logged-in user away from /login', async () => {
    renderApp('/login', { as: 'listener' });
    expect(await screen.findByRole('heading', { name: /, Ann$/ })).toBeInTheDocument();
  });
});
