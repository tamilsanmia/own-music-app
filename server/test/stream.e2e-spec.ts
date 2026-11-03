import { INestApplication } from '@nestjs/common';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { transcodeToHls } from '../src/audio/ffmpeg';
import { PrismaService } from '../src/prisma/prisma.service';
import { ActiveUserCache } from '../src/stream/active-user.cache';
import { StreamTokenService } from '../src/stream/stream-token.service';
import { makeFixtures } from './fixtures';
import { adminToken, createListener, createTestApp, login, resetDb } from './helpers';

const MEDIA = process.env.MEDIA_ROOT!;

describe('Streaming', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tokens: StreamTokenService;
  let admin: string;
  let listener: { id: string; token: string };
  let trackId: string;
  let otherTrackId: string;
  const http = () => request(app.getHttpServer());
  const binary = (r: request.Test) =>
    r.buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

  async function streamUrl(id = trackId, token = listener.token) {
    return (await http().get(`/api/tracks/${id}/stream-url`).set('Authorization', `Bearer ${token}`).expect(200)).body as {
      url: string;
      expiresAt: string;
    };
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    tokens = app.get(StreamTokenService);
    await resetDb(app);
    admin = await adminToken(app);
    const l = await createListener(app, admin);
    listener = { id: l.id, token: (await login(app, l.email, l.password)).body.accessToken };

    // One READY track with real HLS output, one other READY track, one still PENDING.
    const artist = await prisma.artist.create({ data: { name: 'Tone' } });
    const album = await prisma.album.create({ data: { title: 'Tones', artistId: artist.id } });
    const mk = (n: number, status: 'READY' | 'PENDING') =>
      prisma.track.create({ data: { title: `T${n}`, albumId: album.id, artistId: artist.id, trackNumber: n, status, originalExt: 'wav' } });
    trackId = (await mk(1, 'READY')).id;
    otherTrackId = (await mk(2, 'READY')).id;
    await mk(3, 'PENDING');

    const fx = await makeFixtures(join(MEDIA, '..', `stream-fixtures-${process.pid}`));
    const out = join(MEDIA, 'hls', trackId);
    mkdirSync(out, { recursive: true });
    await transcodeToHls(fx.wav, out);
  });
  afterAll(async () => {
    rmSync(join(MEDIA, 'hls', trackId), { recursive: true, force: true });
    await app.close();
  });
  beforeEach(() => app.get(ActiveUserCache).clear());

  describe('GET /api/tracks/:id/stream-url', () => {
    it('returns a relative URL that expires in 6 hours', async () => {
      const before = Date.now();
      const { url, expiresAt } = await streamUrl();
      expect(url).toMatch(new RegExp(`^/stream/[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{43}/${trackId}/master\\.m3u8$`));
      const ttl = new Date(expiresAt).getTime() - before;
      expect(ttl).toBeGreaterThan(6 * 3600_000 - 5_000);
      expect(ttl).toBeLessThanOrEqual(6 * 3600_000 + 1_000);
    });

    it('requires login and a READY track', async () => {
      await http().get(`/api/tracks/${trackId}/stream-url`).expect(401);
      const pending = await prisma.track.findFirstOrThrow({ where: { status: 'PENDING' } });
      await http().get(`/api/tracks/${pending.id}/stream-url`).set('Authorization', `Bearer ${listener.token}`).expect(404);
      await http()
        .get('/api/tracks/00000000-0000-4000-8000-000000000000/stream-url')
        .set('Authorization', `Bearer ${listener.token}`)
        .expect(404);
    });
  });

  describe('GET /stream/...', () => {
    it('serves the master playlist, variant playlists and segments without an Authorization header', async () => {
      const { url } = await streamUrl();
      const master = await http().get(url).expect(200);
      expect(master.headers['content-type']).toMatch(/^application\/vnd\.apple\.mpegurl/);
      expect(master.headers['cache-control']).toMatch(/^private, max-age=\d+$/);
      expect(master.text).toContain('160k/index.m3u8');

      const base = url.replace(/master\.m3u8$/, '');
      const variant = await http().get(`${base}160k/index.m3u8`).expect(200);
      const init = variant.text.match(/URI="([^"]+)"/)![1];
      const seg = variant.text.split('\n').find((l) => l.endsWith('.m4s'))!;

      const initRes = await binary(http().get(`${base}160k/${init}`)).expect(200);
      expect(initRes.headers['content-type']).toBe('audio/mp4');
      expect((initRes.body as Buffer).subarray(4, 8).toString()).toBe('ftyp');
      const segRes = await binary(http().get(`${base}160k/${seg}`)).expect(200);
      expect((segRes.body as Buffer).length).toBeGreaterThan(1000);
    });

    it('supports byte ranges', async () => {
      const { url } = await streamUrl();
      const res = await http().get(url).set('Range', 'bytes=0-6').expect(206);
      expect(res.text).toBe('#EXTM3U');
    });

    it('rejects an expired token', async () => {
      const { token } = tokens.sign(listener.id, trackId, -1);
      await http().get(`/stream/${token}/${trackId}/master.m3u8`).expect(403);
    });

    it('rejects a token for a different track', async () => {
      const { url } = await streamUrl(otherTrackId);
      const token = url.split('/')[2];
      await http().get(`/stream/${token}/${trackId}/master.m3u8`).expect(403);
    });

    it('rejects tampered and missing tokens', async () => {
      const { url } = await streamUrl();
      const token = url.split('/')[2];
      const bad = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
      await http().get(`/stream/${bad}/${trackId}/master.m3u8`).expect(403);
      await http().get(`/stream/x/${trackId}/master.m3u8`).expect(403);
      // No token segment at all: no route matches.
      await http().get(`/stream/${trackId}/master.m3u8`).expect(404);
    });

    it('only serves HLS files inside the track folder', async () => {
      const { url } = await streamUrl();
      const base = url.replace(/master\.m3u8$/, '');
      const token = url.split('/')[2];
      for (const p of [
        '../../originals/x.wav',
        '..%2F..%2Foriginals%2Fx.wav',
        '%2e%2e/%2e%2e/originals/x.wav',
        '160k/../../other/master.m3u8',
        '160k/.hidden',
        'notes.txt',
        '999k/index.m3u8',
      ]) {
        const res = await http().get(`${base}${p}`);
        expect([p, res.status]).toEqual([p, expect.any(Number)]);
        expect(res.status === 404 || res.status === 403).toBe(true);
      }
      // Valid path pattern but no such segment.
      await http().get(`${base}160k/seg_999.m4s`).expect(404);
      // A valid token can't be pointed at another track's folder.
      await http().get(`/stream/${token}/${otherTrackId}/master.m3u8`).expect(403);
    });

    it('stops working for a deactivated user', async () => {
      const { url } = await streamUrl();
      await http().get(url).expect(200);
      await http()
        .patch(`/api/admin/users/${listener.id}`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ isActive: false })
        .expect(200);
      await http().get(url).expect(403);
      await http()
        .patch(`/api/admin/users/${listener.id}`)
        .set('Authorization', `Bearer ${admin}`)
        .send({ isActive: true })
        .expect(200);
      await http().get(url).expect(200);
    });
  });
});
