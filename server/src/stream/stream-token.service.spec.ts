import type { ConfigService } from '@nestjs/config';
import { StreamTokenService } from './stream-token.service';

const config = (secret: string) =>
  ({ get: (k: string) => (k === 'STREAM_SECRET' ? secret : 21600) }) as unknown as ConfigService<never, true>;

describe('StreamTokenService', () => {
  const svc = new StreamTokenService(config('s'.repeat(40)));
  const user = '11111111-1111-4111-8111-111111111111';
  const track = '22222222-2222-4222-8222-222222222222';
  const other = '33333333-3333-4333-8333-333333333333';
  const now = Date.UTC(2026, 10, 3, 12, 0, 0);

  it('round-trips and uses only URL-path-safe characters', () => {
    const { token, expiresAt } = svc.sign(user, track, 3600, now);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(expiresAt.getTime()).toBe(now + 3600_000);
    expect(svc.verify(token, track, now)).toEqual({
      ok: true,
      claims: { userId: user, trackId: track, exp: (now + 3600_000) / 1000 },
    });
  });

  it('defaults to a 6 hour lifetime', () => {
    expect(svc.sign(user, track, undefined, now).expiresAt.getTime() - now).toBe(6 * 3600_000);
  });

  it('expires', () => {
    const { token } = svc.sign(user, track, 60, now);
    expect(svc.verify(token, track, now + 59_000).ok).toBe(true);
    expect(svc.verify(token, track, now + 60_000)).toEqual({ ok: false, reason: 'expired' });
  });

  it('is scoped to one track', () => {
    const { token } = svc.sign(user, track, 60, now);
    expect(svc.verify(token, other, now)).toEqual({ ok: false, reason: 'track' });
  });

  it('rejects tampered payloads and signatures', () => {
    const { token } = svc.sign(user, track, 60, now);
    const [payload, sig] = token.split('.');
    // Swap in another track id but keep the old signature.
    const forged = Buffer.from(`${user}.${other}.${(now / 1000) + 60}`).toString('base64url');
    expect(svc.verify(`${forged}.${sig}`, other, now)).toEqual({ ok: false, reason: 'signature' });
    // Extend the expiry.
    const later = Buffer.from(`${user}.${track}.${(now / 1000) + 999_999}`).toString('base64url');
    expect(svc.verify(`${later}.${sig}`, track, now)).toEqual({ ok: false, reason: 'signature' });
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    expect(svc.verify(`${payload}.${flipped}`, track, now)).toEqual({ ok: false, reason: 'signature' });
    expect(svc.verify(`${payload}.${sig}x`, track, now)).toEqual({ ok: false, reason: 'signature' });
  });

  it('rejects tokens signed with another secret', () => {
    const { token } = new StreamTokenService(config('t'.repeat(40))).sign(user, track, 60, now);
    expect(svc.verify(token, track, now)).toEqual({ ok: false, reason: 'signature' });
  });

  it('rejects malformed tokens', () => {
    expect(svc.verify('', track, now).ok).toBe(false);
    expect(svc.verify('abc', track, now)).toEqual({ ok: false, reason: 'malformed' });
    expect(svc.verify('a.b.c', track, now)).toEqual({ ok: false, reason: 'malformed' });
    // Correctly signed but not "<uuid>.<uuid>.<digits>".
    const weird = Buffer.from('not.a.token').toString('base64url');
    const signed = `${weird}.${(svc as unknown as { mac(p: string): string }).mac(weird)}`;
    expect(svc.verify(signed, track, now)).toEqual({ ok: false, reason: 'malformed' });
  });
});
