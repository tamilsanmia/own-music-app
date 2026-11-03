import type { CookieOptions, Request, Response } from 'express';
import type { Session } from './auth.service';

/**
 * How refresh tokens travel:
 * - web: httpOnly, Secure, SameSite=Strict cookie scoped to /api/auth. JavaScript never sees it.
 * - mobile: returned in the JSON body; the Android app stores it encrypted.
 */
export type ClientKind = 'web' | 'mobile';

export const REFRESH_COOKIE = 'music_rt';
const COOKIE_PATH = '/api/auth';

function cookieOptions(secure: boolean, expires?: Date): CookieOptions {
  return { httpOnly: true, secure, sameSite: 'strict', path: COOKIE_PATH, expires };
}

export function readRefreshToken(req: Request, bodyToken?: string): string | undefined {
  return bodyToken || (req.cookies?.[REFRESH_COOKIE] as string | undefined) || undefined;
}

export function sendSession(res: Response, session: Session, client: ClientKind, secureCookie: boolean) {
  const body = {
    accessToken: session.accessToken,
    expiresIn: session.expiresIn,
    user: session.user,
  };
  if (client === 'mobile') {
    return { ...body, refreshToken: session.refreshToken, refreshExpiresAt: session.refreshExpiresAt };
  }
  res.cookie(REFRESH_COOKIE, session.refreshToken, cookieOptions(secureCookie, session.refreshExpiresAt));
  return body;
}

export function clearRefreshCookie(res: Response, secureCookie: boolean): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions(secureCookie));
}
