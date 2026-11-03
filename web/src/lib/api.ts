/**
 * API client. The access token lives only in memory. The refresh token is an httpOnly cookie the
 * browser sends to /api/auth/*, so JavaScript never sees it.
 *
 * On a 401 the client refreshes once and retries. Refreshes are single-flight within a tab and
 * serialized across tabs with the Web Locks API: the server rotates refresh tokens and treats
 * reuse of an old one as theft, so two tabs refreshing with the same cookie at once would log the
 * user out everywhere.
 */

export type Role = 'ADMIN' | 'USER';

export interface User {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface Session {
  accessToken: string;
  expiresIn: number;
  user: User;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

let accessToken: string | null = null;
let refreshInFlight: Promise<Session> | null = null;
let sessionExpiredListener: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/** Called when the session can't be refreshed any more (logged out elsewhere, deactivated). */
export function onSessionExpired(fn: () => void): () => void {
  sessionExpiredListener = fn;
  return () => {
    if (sessionExpiredListener === fn) sessionExpiredListener = null;
  };
}

function toUrl(path: string): string {
  return new URL(path, window.location.origin).toString();
}

async function parseBody(res: Response): Promise<unknown> {
  if (res.status === 204) return undefined;
  const type = res.headers.get('content-type') ?? '';
  return type.includes('application/json') ? res.json() : res.text();
}

function errorMessage(status: number, body: unknown): string {
  if (status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message: unknown }).message;
    return Array.isArray(m) ? m.join(', ') : String(m);
  }
  return `Request failed (${status})`;
}

function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? (locks.request('music-auth-refresh', fn) as Promise<T>) : fn();
}

export function refreshSession(): Promise<Session> {
  refreshInFlight ??= withRefreshLock(async () => {
    const res = await fetch(toUrl('/api/auth/refresh'), {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const body = await parseBody(res);
    if (!res.ok) {
      accessToken = null;
      throw new ApiError(res.status, errorMessage(res.status, body), body);
    }
    const session = body as Session;
    accessToken = session.accessToken;
    return session;
  }).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** Sent as a JSON body. */
  json?: unknown;
  body?: BodyInit;
}

function send(path: string, opts: RequestOptions): Promise<Response> {
  const { json, headers: rawHeaders, ...rest } = opts;
  const headers = new Headers(rawHeaders);
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  let body = rest.body;
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(json);
  }
  return fetch(toUrl(path), { ...rest, body, headers, credentials: 'same-origin' });
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  let res = await send(path, opts);

  if (res.status === 401 && !path.startsWith('/api/auth/')) {
    try {
      await refreshSession();
    } catch {
      sessionExpiredListener?.();
      throw new ApiError(401, 'Your session has expired. Log in again.');
    }
    res = await send(path, opts);
    if (res.status === 401) sessionExpiredListener?.();
  }

  const body = await parseBody(res);
  if (!res.ok) throw new ApiError(res.status, errorMessage(res.status, body), body);
  return body as T;
}

export const authApi = {
  async login(email: string, password: string): Promise<Session> {
    const session = await api<Session>('/api/auth/login', {
      method: 'POST',
      json: { email, password, client: 'web' },
    });
    accessToken = session.accessToken;
    return session;
  },

  async logout(): Promise<void> {
    try {
      await api<void>('/api/auth/logout', { method: 'POST', json: {} });
    } finally {
      accessToken = null;
    }
  },

  async changePassword(currentPassword: string, newPassword: string): Promise<Session> {
    const session = await api<Session>('/api/me/password', {
      method: 'PATCH',
      json: { currentPassword, newPassword, client: 'web' },
    });
    accessToken = session.accessToken;
    return session;
  },
};

export const usersApi = {
  list: () => api<User[]>('/api/admin/users'),
  create: (input: { email: string; displayName: string; password: string }) =>
    api<User>('/api/admin/users', { method: 'POST', json: input }),
  update: (id: string, input: { displayName?: string; isActive?: boolean; password?: string }) =>
    api<User>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', json: input }),
};
