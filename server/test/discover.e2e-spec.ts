import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { adminToken, createListener, createTestApp, login, resetDb } from './helpers';

describe('Search, likes and history', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ann: string;
  let bob: string;
  const ids: Record<string, string> = {};
  const http = () => request(app.getHttpServer());
  const as = (token: string, r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetDb(app);
    const admin = await adminToken(app);
    const a = await createListener(app, admin, 'ann@test.local');
    const b = await createListener(app, admin, 'bob@test.local');
    ann = (await login(app, a.email, a.password)).body.accessToken;
    bob = (await login(app, b.email, b.password)).body.accessToken;

    const nina = await prisma.artist.create({ data: { name: 'Nina Simone' } });
    const miles = await prisma.artist.create({ data: { name: 'Miles Davis' } });
    const hidden = await prisma.artist.create({ data: { name: 'Nina Unreleased' } });
    const pastel = await prisma.album.create({ data: { title: 'Pastel Blues', artistId: nina.id } });
    const kind = await prisma.album.create({ data: { title: 'Kind of Blue', artistId: miles.id } });
    const draft = await prisma.album.create({ data: { title: 'Blue Drafts', artistId: hidden.id } });
    const track = (title: string, albumId: string, artistId: string, n: number, status: 'READY' | 'PENDING' = 'READY') =>
      prisma.track.create({ data: { title, albumId, artistId, trackNumber: n, status, durationMs: 200_000 } });
    ids.feeling = (await track('Feeling Good', pastel.id, nina.id, 1)).id;
    ids.sinnerman = (await track('Sinnerman', pastel.id, nina.id, 2)).id;
    ids.percent = (await track('100% Blue', pastel.id, nina.id, 3)).id;
    ids.blue = (await track('Blue in Green', kind.id, miles.id, 1)).id;
    ids.soWhat = (await track('So What', kind.id, miles.id, 2)).id;
    ids.blueExact = (await track('Blue', kind.id, miles.id, 3)).id;
    ids.pending = (await track('Blue Pending', kind.id, miles.id, 4, 'PENDING')).id;
    ids.hidden = (await track('Blue Hidden', draft.id, hidden.id, 1, 'PENDING')).id;
    Object.assign(ids, { nina: nina.id, miles: miles.id, pastel: pastel.id, kind: kind.id });
  });
  afterAll(() => app.close());

  const search = (q: string, token = ann) => as(token, http().get('/api/search').query({ q })).expect(200);
  const titles = (items: { title?: string; name?: string }[]) => items.map((i) => i.title ?? i.name);

  describe('GET /api/search', () => {
    it('ranks exact, then prefix, then other matches, and hides unplayable music', async () => {
      const res = await search('blue');
      expect(titles(res.body.tracks)).toEqual(['Blue', 'Blue in Green', '100% Blue']);
      expect(titles(res.body.albums)).toEqual(['Kind of Blue', 'Pastel Blues']);
      expect(res.body.artists).toEqual([]);
      expect(res.body.tracks[0]).toEqual({
        id: ids.blueExact,
        title: 'Blue',
        trackNumber: 3,
        durationMs: 200000,
        artist: { id: ids.miles, name: 'Miles Davis' },
        album: { id: ids.kind, title: 'Kind of Blue', cover: null },
        hasLyrics: false,
        lossless: false,
      });
    });

    it('matches partial words, any case', async () => {
      expect(titles((await search('SINNER')).body.tracks)).toEqual(['Sinnerman']);
      expect(titles((await search('feel')).body.tracks)).toEqual(['Feeling Good']);
    });

    it('tolerates typos', async () => {
      expect(titles((await search('Sinerman')).body.tracks)).toEqual(['Sinnerman']);
      expect(titles((await search('mils davis')).body.artists)).toEqual(['Miles Davis']);
    });

    it('finds tracks and albums by artist name, after title matches', async () => {
      const res = await search('nina');
      expect(titles(res.body.artists)).toEqual(['Nina Simone']);
      expect(titles(res.body.albums)).toEqual(['Pastel Blues']);
      expect(new Set(titles(res.body.tracks))).toEqual(new Set(['Feeling Good', 'Sinnerman', '100% Blue']));
    });

    it('treats % and _ literally', async () => {
      expect(titles((await search('100%')).body.tracks)).toEqual(['100% Blue']);
      expect((await search('%')).body.tracks.map((t: { title: string }) => t.title)).toEqual(['100% Blue']);
      expect((await search('_')).body.tracks).toEqual([]);
    });

    it('validates the query and requires login', async () => {
      await as(ann, http().get('/api/search')).expect(400);
      await as(ann, http().get('/api/search').query({ q: '   ' })).expect(400);
      await as(ann, http().get('/api/search').query({ q: 'x'.repeat(101) })).expect(400);
      await http().get('/api/search').query({ q: 'blue' }).expect(401);
    });
  });

  describe('likes', () => {
    it('like and unlike are idempotent', async () => {
      await as(ann, http().put(`/api/me/likes/${ids.feeling}`)).expect(204);
      await as(ann, http().put(`/api/me/likes/${ids.feeling}`)).expect(204);
      await as(ann, http().get('/api/me/likes/ids')).expect(200, [ids.feeling]);

      await as(ann, http().delete(`/api/me/likes/${ids.feeling}`)).expect(204);
      await as(ann, http().delete(`/api/me/likes/${ids.feeling}`)).expect(204);
      await as(ann, http().get('/api/me/likes/ids')).expect(200, []);
    });

    it('lists liked songs newest first with album info, and keeps users apart', async () => {
      await as(ann, http().put(`/api/me/likes/${ids.feeling}`)).expect(204);
      await new Promise((r) => setTimeout(r, 5));
      await as(ann, http().put(`/api/me/likes/${ids.soWhat}`)).expect(204);
      await as(bob, http().put(`/api/me/likes/${ids.blue}`)).expect(204);

      const res = await as(ann, http().get('/api/me/likes')).expect(200);
      expect(res.body.total).toBe(2);
      expect(titles(res.body.items)).toEqual(['So What', 'Feeling Good']);
      expect(res.body.items[0]).toMatchObject({ album: { id: ids.kind, title: 'Kind of Blue' }, likedAt: expect.any(String) });
      await as(bob, http().get('/api/me/likes/ids')).expect(200, [ids.blue]);
      const page = await as(ann, http().get('/api/me/likes').query({ limit: 1, offset: 1 })).expect(200);
      expect(titles(page.body.items)).toEqual(['Feeling Good']);
    });

    it('only playable tracks can be liked', async () => {
      await as(ann, http().put(`/api/me/likes/${ids.pending}`)).expect(404);
      await as(ann, http().put('/api/me/likes/00000000-0000-4000-8000-000000000000')).expect(404);
      await as(ann, http().put('/api/me/likes/nope')).expect(400);
    });

    it('likes disappear with the track', async () => {
      await as(ann, http().put(`/api/me/likes/${ids.soWhat}`)).expect(204);
      await prisma.track.delete({ where: { id: ids.soWhat } });
      await as(ann, http().get('/api/me/likes/ids')).expect(200, []);
    });
  });

  describe('history', () => {
    const play = (trackId: string, playedAt?: string, token = ann) =>
      as(token, http().post('/api/me/history')).send({ trackId, ...(playedAt ? { playedAt } : {}) });
    const ago = (s: number) => new Date(Date.now() - s * 1000).toISOString();

    it('lists recently played tracks newest first, each once', async () => {
      await play(ids.feeling, ago(300)).expect(204);
      await play(ids.soWhat, ago(200)).expect(204);
      await play(ids.feeling, ago(100)).expect(204);
      await play(ids.blue, ago(50), bob).expect(204);

      const res = await as(ann, http().get('/api/me/recent')).expect(200);
      expect(titles(res.body.items)).toEqual(['Feeling Good', 'So What']);
      expect(res.body.items[0]).toMatchObject({ album: { title: 'Pastel Blues' }, playedAt: expect.any(String) });
      expect(await prisma.playHistory.count({ where: { trackId: ids.feeling } })).toBe(2);
    });

    it('counts a repeated report within 30 seconds once', async () => {
      const at = ago(60);
      await play(ids.feeling, at).expect(204);
      await play(ids.feeling, at).expect(204);
      await play(ids.feeling, ago(50)).expect(204);
      expect(await prisma.playHistory.count()).toBe(1);
      await play(ids.feeling).expect(204); // 60 s later
      expect(await prisma.playHistory.count()).toBe(2);
    });

    it('rejects future, very old and unplayable plays', async () => {
      await play(ids.feeling, new Date(Date.now() + 3600_000).toISOString()).expect(400);
      await play(ids.feeling, ago(31 * 24 * 3600)).expect(400);
      await play(ids.feeling, 'yesterday').expect(400);
      await play(ids.pending).expect(404);
      expect(await prisma.playHistory.count()).toBe(0);
    });

    it('hides tracks that stopped being playable', async () => {
      await play(ids.feeling).expect(204);
      await prisma.track.update({ where: { id: ids.feeling }, data: { status: 'FAILED' } });
      await as(ann, http().get('/api/me/recent')).expect(200, { items: [] });
    });
  });
});
