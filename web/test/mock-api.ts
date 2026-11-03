import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import type { User } from '@/lib/api';

/**
 * In-memory fake of the auth/users API. `session` stands in for the browser's refresh cookie:
 * when set, POST /api/auth/refresh succeeds for that user.
 */
export const db = {
  users: [] as (User & { password: string })[],
  session: null as string | null,
  calls: { refresh: 0, createUser: [] as unknown[] },
};

const now = '2026-11-01T10:00:00.000Z';

export function resetDb(): void {
  db.users = [
    { id: 'u-admin', email: 'admin@music.test', displayName: 'Admin', role: 'ADMIN', isActive: true, createdAt: now, password: 'admin-pass' },
    { id: 'u-ann', email: 'ann@music.test', displayName: 'Ann', role: 'USER', isActive: true, createdAt: now, password: 'ann-pass-1' },
  ];
  db.session = null;
  db.calls = { refresh: 0, createUser: [] };
}

const publicUser = ({ password: _password, ...u }: User & { password: string }): User => u;
const sessionFor = (u: User & { password: string }) => ({ accessToken: `at-${u.id}`, expiresIn: 900, user: publicUser(u) });

function caller(request: Request) {
  const token = request.headers.get('authorization')?.replace(/^Bearer at-/, '');
  return db.users.find((u) => u.id === token && u.isActive);
}

const unauthorized = () => HttpResponse.json({ message: 'Unauthorized', statusCode: 401 }, { status: 401 });
const forbidden = () => HttpResponse.json({ message: 'Forbidden', statusCode: 403 }, { status: 403 });

export const handlers = [
  http.post('*/api/auth/login', async ({ request }) => {
    const { email, password } = (await request.json()) as { email: string; password: string };
    const user = db.users.find((u) => u.email === email.toLowerCase() && u.password === password && u.isActive);
    if (!user) return HttpResponse.json({ message: 'Invalid email or password', statusCode: 401 }, { status: 401 });
    db.session = user.id;
    return HttpResponse.json(sessionFor(user));
  }),

  http.post('*/api/auth/refresh', () => {
    db.calls.refresh += 1;
    const user = db.users.find((u) => u.id === db.session && u.isActive);
    return user ? HttpResponse.json(sessionFor(user)) : unauthorized();
  }),

  http.post('*/api/auth/logout', () => {
    db.session = null;
    return new HttpResponse(null, { status: 204 });
  }),

  http.get('*/api/me', ({ request }) => {
    const user = caller(request);
    return user ? HttpResponse.json(publicUser(user)) : unauthorized();
  }),

  http.get('*/api/admin/users', ({ request }) => {
    const user = caller(request);
    if (!user) return unauthorized();
    if (user.role !== 'ADMIN') return forbidden();
    return HttpResponse.json(db.users.map(publicUser));
  }),

  http.post('*/api/admin/users', async ({ request }) => {
    const user = caller(request);
    if (!user) return unauthorized();
    if (user.role !== 'ADMIN') return forbidden();
    const body = (await request.json()) as { email: string; displayName: string; password: string };
    db.calls.createUser.push(body);
    if (db.users.some((u) => u.email === body.email.toLowerCase())) {
      return HttpResponse.json({ message: 'A user with this email already exists', statusCode: 409 }, { status: 409 });
    }
    const created = {
      id: `u-${db.users.length + 1}`,
      email: body.email.toLowerCase(),
      displayName: body.displayName,
      role: 'USER' as const,
      isActive: true,
      createdAt: now,
      password: body.password,
    };
    db.users.push(created);
    return HttpResponse.json(publicUser(created), { status: 201 });
  }),

  http.patch('*/api/admin/users/:id', async ({ request, params }) => {
    const user = caller(request);
    if (!user) return unauthorized();
    if (user.role !== 'ADMIN') return forbidden();
    const target = db.users.find((u) => u.id === params.id);
    if (!target) return HttpResponse.json({ message: 'Not Found', statusCode: 404 }, { status: 404 });
    Object.assign(target, (await request.json()) as Partial<User & { password: string }>);
    return HttpResponse.json(publicUser(target));
  }),
];

// mock-catalog.ts reads `db` only inside handlers, so this circular import is safe.
import { catalogHandlers } from './mock-catalog';

export const server = setupServer(...handlers, ...catalogHandlers);
