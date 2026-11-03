import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { db, server } from '../../test/mock-api';
import { api, ApiError, onSessionExpired, setAccessToken, type User } from './api';

describe('api client', () => {
  it('refreshes once on 401 and retries the request', async () => {
    db.session = 'u-ann';
    setAccessToken('at-expired');
    const me = await api<User>('/api/me');
    expect(me.email).toBe('ann@music.test');
    expect(db.calls.refresh).toBe(1);
  });

  it('shares one refresh between concurrent 401s', async () => {
    db.session = 'u-ann';
    setAccessToken('at-expired');
    const results = await Promise.all([api<User>('/api/me'), api<User>('/api/me'), api<User>('/api/me')]);
    expect(results.map((u) => u.id)).toEqual(['u-ann', 'u-ann', 'u-ann']);
    expect(db.calls.refresh).toBe(1);
  });

  it('reports an expired session when the refresh fails', async () => {
    const expired = vi.fn();
    const off = onSessionExpired(expired);
    setAccessToken('at-expired');
    await expect(api('/api/me')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
    off();
  });

  it('does not try to refresh after a failed login', async () => {
    await expect(
      api('/api/auth/login', { method: 'POST', json: { email: 'x@y.z', password: 'nope' } }),
    ).rejects.toThrow('Invalid email or password');
    expect(db.calls.refresh).toBe(0);
  });

  it('joins validation messages into one error', async () => {
    server.use(
      http.get('*/api/thing', () =>
        HttpResponse.json({ message: ['email must be an email', 'password is too short'] }, { status: 400 }),
      ),
    );
    const err = await api('/api/thing').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('email must be an email, password is too short');
  });
});
