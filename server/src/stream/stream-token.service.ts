import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Env } from '../config/env';

export interface StreamClaims {
  userId: string;
  trackId: string;
  /** Expiry, Unix seconds. */
  exp: number;
}

export type VerifyResult = { ok: true; claims: StreamClaims } | { ok: false; reason: 'malformed' | 'signature' | 'expired' | 'track' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stream tokens: base64url("<userId>.<trackId>.<exp>") + "." + base64url(HMAC-SHA256).
 * Only URL-path-safe characters, so the token sits in the path and relative segment URLs in
 * the HLS playlists inherit it. Scoped to one track; expires after STREAM_TTL_SECONDS.
 */
@Injectable()
export class StreamTokenService {
  private readonly secret: string;
  readonly ttlSeconds: number;

  constructor(config: ConfigService<Env, true>) {
    this.secret = config.get('STREAM_SECRET', { infer: true });
    this.ttlSeconds = config.get('STREAM_TTL_SECONDS', { infer: true });
  }

  sign(userId: string, trackId: string, ttlSeconds = this.ttlSeconds, nowMs = Date.now()): { token: string; expiresAt: Date } {
    const exp = Math.floor(nowMs / 1000) + ttlSeconds;
    const payload = Buffer.from(`${userId}.${trackId}.${exp}`).toString('base64url');
    return { token: `${payload}.${this.mac(payload)}`, expiresAt: new Date(exp * 1000) };
  }

  verify(token: string, trackId: string, nowMs = Date.now()): VerifyResult {
    const parts = token.split('.');
    if (parts.length !== 2) return { ok: false, reason: 'malformed' };
    const [payload, sig] = parts;

    const expected = Buffer.from(this.mac(payload));
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      return { ok: false, reason: 'signature' };
    }

    const fields = Buffer.from(payload, 'base64url').toString('utf8').split('.');
    if (fields.length !== 3 || !UUID.test(fields[0]) || !UUID.test(fields[1]) || !/^\d+$/.test(fields[2])) {
      return { ok: false, reason: 'malformed' };
    }
    const claims: StreamClaims = { userId: fields[0], trackId: fields[1], exp: Number(fields[2]) };
    if (claims.exp * 1000 <= nowMs) return { ok: false, reason: 'expired' };
    if (claims.trackId.toLowerCase() !== trackId.toLowerCase()) return { ok: false, reason: 'track' };
    return { ok: true, claims };
  }

  private mac(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}
