import { INestApplication } from '@nestjs/common';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { probe, transcodeLossless, transcodeToHls } from '../src/audio/ffmpeg';
import { PrismaService } from '../src/prisma/prisma.service';
import { makeAudioFormats } from './fixtures';
import { adminToken, createListener, createTestApp, login, resetDb } from './helpers';

const MEDIA = process.env.MEDIA_ROOT!;

describe('Lyrics, genres, home sections, radio, profile and lossless', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: string;
  let listener: { id: string; token: string };
  let other: { id: string; token: string };
  const http = () => request(app.getHttpServer());
  const asAdmin = (r: request.Test) => r.set('Authorization', `Bearer ${admin}`);
  const as = (who: { token: string }) => (r: request.Test) => r.set('Authorization', `Bearer ${who.token}`);

  let deva: string;
  let sai: string;
  let vaali: string;
  let kushi: string;
  let om: string;
  /** Track ids by title. */
  const ids: Record<string, string> = {};

  async function album(artistId: string, title: string, genres: string[]) {
    return (await asAdmin(http().post('/api/admin/albums')).send({ title, artistId, genres }).expect(201)).body as {
      id: string;
      genres: string[];
    };
  }
  async function track(albumId: string, artistId: string, title: string, n: number, extra: object = {}) {
    const t = await prisma.track.create({
      data: { title, albumId, artistId, trackNumber: n, status: 'READY', durationMs: 200_000, ...extra },
    });
    ids[title] = t.id;
    return t.id;
  }
  async function play(who: { token: string }, trackId: string, minutesAgo: number) {
    const playedAt = new Date(Date.now() - minutesAgo * 60_000).toISOString();
    await as(who)(http().post('/api/me/history')).send({ trackId, playedAt }).expect(204);
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    await resetDb(app);
    admin = await adminToken(app);
    const l = await createListener(app, admin);
    listener = { id: l.id, token: (await login(app, l.email, l.password)).body.accessToken };
    const o = await createListener(app, admin, 'other@test.local', 'other-pass-123');
    other = { id: o.id, token: (await login(app, o.email, o.password)).body.accessToken };

    deva = (await asAdmin(http().post('/api/admin/artists')).send({ name: 'Deva' }).expect(201)).body.id;
    sai = (await asAdmin(http().post('/api/admin/artists')).send({ name: 'Sai' }).expect(201)).body.id;
    vaali = (await album(deva, 'Vaali', ['Melody', 'Romance'])).id;
    kushi = (await album(deva, 'Kushi', [' melody ', 'Kuthu', 'MELODY'])).id;
    om = (await album(sai, 'OM', ['Indie'])).id;
    for (let i = 1; i <= 4; i++) await track(vaali, deva, `Vaali ${i}`, i);
    for (let i = 1; i <= 4; i++) await track(kushi, deva, `Kushi ${i}`, i);
    for (let i = 1; i <= 4; i++) await track(om, sai, `OM ${i}`, i);
    // An album without playable tracks stays out of genre lists.
    const hidden = await album(sai, 'Hidden', ['Secret']);
    await prisma.track.create({ data: { title: 'Pending', albumId: hidden.id, artistId: sai, trackNumber: 1, status: 'PENDING' } });
  });

  afterAll(() => app.close());

  describe('genres', () => {
    it('keeps the first spelling and drops duplicates ignoring case', async () => {
      const res = await as(listener)(http().get(`/api/albums/${kushi}`)).expect(200);
      expect(res.body.genres).toEqual(['Melody', 'Kuthu']);
    });

    it('lists genres with playable albums, most albums first, with a cover', async () => {
      const res = await as(listener)(http().get('/api/genres')).expect(200);
      expect(res.body.map((g: { name: string; albumCount: number }) => [g.name, g.albumCount])).toEqual([
        ['Melody', 2],
        ['Indie', 1],
        ['Kuthu', 1],
        ['Romance', 1],
      ]);
      expect(res.body[0]).toHaveProperty('cover', null);
    });

    it('shows the albums of a genre, matching case-insensitively', async () => {
      const res = await as(listener)(http().get('/api/genres/melody')).expect(200);
      expect(res.body.name).toBe('Melody');
      expect(res.body.albums.map((a: { title: string }) => a.title).sort()).toEqual(['Kushi', 'Vaali']);
      await as(listener)(http().get('/api/genres/Secret')).expect(404);
      await as(listener)(http().get('/api/genres/Nope')).expect(404);
    });

    it('lets the admin replace genres, suggests every name, and validates input', async () => {
      await asAdmin(http().patch(`/api/admin/albums/${om}`)).send({ genres: ['indie', 'Chill'] }).expect(200);
      expect((await as(listener)(http().get(`/api/albums/${om}`))).body.genres).toEqual(['Indie', 'Chill']);
      const names = await asAdmin(http().get('/api/admin/genres')).expect(200);
      expect(names.body).toEqual(['Chill', 'Indie', 'Kuthu', 'Melody', 'Romance', 'Secret']);
      await as(listener)(http().get('/api/admin/genres')).expect(403);
      await asAdmin(http().patch(`/api/admin/albums/${om}`)).send({ genres: ['a', 'b', 'c', 'd', 'e', 'f'] }).expect(400);
      await asAdmin(http().patch(`/api/admin/albums/${om}`)).send({ genres: ['  '] }).expect(400);
      await asAdmin(http().patch(`/api/admin/albums/${om}`)).send({ genres: ['x'.repeat(41)] }).expect(400);
      // Leaving genres out keeps them.
      await asAdmin(http().patch(`/api/admin/albums/${om}`)).send({ title: 'OM' }).expect(200);
      expect((await as(listener)(http().get(`/api/albums/${om}`))).body.genres).toEqual(['Indie', 'Chill']);
    });
  });

  describe('lyrics', () => {
    it('are set by the admin and read by listeners; LRC is detected as synced', async () => {
      const id = ids['Vaali 1'];
      await as(listener)(http().get(`/api/tracks/${id}/lyrics`)).expect(200, { lyrics: null, synced: false });
      const lrc = '[00:01.00] First line\r\n[00:05.50] Second line\r\n';
      const res = await asAdmin(http().patch(`/api/admin/tracks/${id}`)).send({ lyrics: lrc }).expect(200);
      expect(res.body.lyrics).toBe('[00:01.00] First line\n[00:05.50] Second line');
      await as(listener)(http().get(`/api/tracks/${id}/lyrics`)).expect(200, {
        lyrics: '[00:01.00] First line\n[00:05.50] Second line',
        synced: true,
      });
      const albumRes = await as(listener)(http().get(`/api/albums/${vaali}`)).expect(200);
      expect(albumRes.body.tracks.map((t: { hasLyrics: boolean }) => t.hasLyrics)).toEqual([true, false, false, false]);
    });

    it('plain text is not synced, and empty text removes the lyrics', async () => {
      const id = ids['Vaali 2'];
      await asAdmin(http().patch(`/api/admin/tracks/${id}`)).send({ lyrics: 'Just words\nMore words' }).expect(200);
      expect((await as(listener)(http().get(`/api/tracks/${id}/lyrics`))).body).toEqual({ lyrics: 'Just words\nMore words', synced: false });
      await asAdmin(http().patch(`/api/admin/tracks/${id}`)).send({ lyrics: '   ' }).expect(200);
      expect((await as(listener)(http().get(`/api/tracks/${id}/lyrics`))).body.lyrics).toBeNull();
      await asAdmin(http().patch(`/api/admin/tracks/${id}`)).send({ lyrics: 'x'.repeat(20_001) }).expect(400);
      await as(listener)(http().patch(`/api/admin/tracks/${id}`)).send({ lyrics: 'nope' }).expect(403);
    });

    it('are only served for playable tracks', async () => {
      const pending = await prisma.track.findFirstOrThrow({ where: { status: 'PENDING' } });
      await as(listener)(http().get(`/api/tracks/${pending.id}/lyrics`)).expect(404);
    });
  });

  describe('home sections', () => {
    beforeAll(async () => {
      // Listener: Kushi 1 three times, OM 1 twice, Vaali 3 once. Other: OM 2 four times.
      for (const m of [10, 20, 30]) await play(listener, ids['Kushi 1'], m);
      for (const m of [40, 50]) await play(listener, ids['OM 1'], m);
      await play(listener, ids['Vaali 3'], 60);
      for (const m of [5, 15, 25, 35]) await play(other, ids['OM 2'], m);
      // Older than a week: counts for "your top songs" (90 days) but not "this week".
      for (const days of [8, 9, 10]) await play(other, ids['Vaali 4'], days * 24 * 60);
    });

    it('show my most played songs (at least two plays) and this week’s top songs', async () => {
      const res = await as(listener)(http().get('/api/home')).expect(200);
      expect(res.body.mostPlayed.map((t: { title: string }) => t.title)).toEqual(['Kushi 1', 'OM 1']);
      expect(res.body.mostPlayed[0].album).toMatchObject({ id: kushi, title: 'Kushi' });
      expect(res.body.topThisWeek.map((t: { title: string }) => t.title)).toEqual(['OM 2', 'Kushi 1', 'OM 1', 'Vaali 3']);
      expect(res.body.genres.map((g: { name: string }) => g.name)).toContain('Melody');
      expect(res.body.newAlbums.length).toBe(3);

      const theirs = await as(other)(http().get('/api/home')).expect(200);
      expect(theirs.body.mostPlayed.map((t: { title: string }) => t.title)).toEqual(['OM 2', 'Vaali 4']);
    });
  });

  describe('radio', () => {
    const radio = (body: object) => as(listener)(http().post('/api/radio')).send(body);

    it('favours the same artist and genres, skips the queue, and limits songs per album', async () => {
      const seed = ids['Vaali 1'];
      const res = await radio({ seedTrackId: seed, excludeTrackIds: [ids['Vaali 2']], limit: 6 }).expect(200);
      const titles: string[] = res.body.items.map((t: { title: string }) => t.title);
      expect(titles).toHaveLength(6);
      expect(titles).not.toContain('Vaali 1');
      expect(titles).not.toContain('Vaali 2');
      // Deva + Melody outrank Sai's Indie album: the 2 Vaali songs left and 3 (the per-album
      // cap) from Kushi come first; only then one from OM.
      expect(titles.slice(0, 5).filter((t) => t.startsWith('Vaali')).sort()).toEqual(['Vaali 3', 'Vaali 4']);
      expect(titles.slice(0, 5).filter((t) => t.startsWith('Kushi'))).toHaveLength(3);
      expect(titles[5]).toMatch(/^OM /);
      expect(res.body.items[0]).toHaveProperty('album.title');
    });

    it('repeats older songs once the catalog runs out, but never the last 15 in the queue', async () => {
      const all = Object.values(ids);
      const seed = ids['OM 1'];
      const queue = [seed, ...all.filter((id) => id !== seed)];
      const res = await radio({ seedTrackId: seed, excludeTrackIds: queue, limit: 20 }).expect(200);
      const got: string[] = res.body.items.map((t: { id: string }) => t.id);
      const recent = new Set(queue.slice(-15));
      // 12 tracks, all in the last 15 entries: nothing can repeat yet.
      expect(got.filter((id) => recent.has(id))).toEqual([]);
      expect(got).toEqual([]);
    });

    it('validates the request', async () => {
      await radio({ seedTrackId: 'not-a-uuid' }).expect(400);
      await radio({ seedTrackId: ids['OM 1'], limit: 51 }).expect(400);
      await radio({ seedTrackId: '00000000-0000-4000-8000-000000000000' }).expect(404);
      await http().post('/api/radio').send({ seedTrackId: ids['OM 1'] }).expect(401);
    });
  });

  describe('profile', () => {
    it('lets a listener change their display name', async () => {
      const res = await as(listener)(http().patch('/api/me')).send({ displayName: '  Tamil  ' }).expect(200);
      expect(res.body).toMatchObject({ id: listener.id, displayName: 'Tamil' });
      expect((await as(listener)(http().get('/api/me'))).body.displayName).toBe('Tamil');
      await as(listener)(http().patch('/api/me')).send({ displayName: '   ' }).expect(400);
      await as(listener)(http().patch('/api/me')).send({ displayName: 'x'.repeat(101) }).expect(400);
      // Only the name: role, email and the active flag can't be changed here.
      await as(listener)(http().patch('/api/me')).send({ displayName: 'A', role: 'ADMIN' }).expect(400);
    });
  });

  describe('lossless streams', () => {
    let fx: { flac: string; mp3: string };
    let flacId: string;
    let mp3Id: string;

    beforeAll(async () => {
      fx = await makeAudioFormats(join(MEDIA, '..', `formats-${process.pid}`));
      flacId = await track(om, sai, 'Hi-res', 9, { lossless: true, originalExt: 'flac' });
      mp3Id = await track(om, sai, 'Lossy', 10, { originalExt: 'mp3' });
      for (const [id, file, lossless] of [[flacId, fx.flac, true], [mp3Id, fx.mp3, false]] as const) {
        const out = join(MEDIA, 'hls', id);
        mkdirSync(out, { recursive: true });
        await transcodeToHls(file, out);
        if (lossless) await transcodeLossless(file, out, await probe(file));
      }
    }, 120_000);

    it('keeps 24-bit / 96 kHz in FLAC and names the codec in the playlist', async () => {
      const info = await probe(fx.flac);
      expect(info).toMatchObject({ codec: 'flac', sampleRate: 96000, bitDepth: 24 });
      expect(info.summary).toBe('flac · 96 kHz · 24-bit · stereo');
      const out = join(MEDIA, 'hls', flacId);
      const master = readFileSync(join(out, 'lossless.m3u8'), 'utf8');
      expect(master).toMatch(/#EXT-X-STREAM-INF:BANDWIDTH=\d+,CODECS="fLaC"\nflac\/index\.m3u8/);
      const bandwidth = Number(/BANDWIDTH=(\d+)/.exec(master)![1]);
      expect(bandwidth).toBeGreaterThan(320_000); // well above the best AAC variant
      const segs = readdirSync(join(out, 'flac')).filter((f) => f.endsWith('.m4s'));
      expect(segs.length).toBeGreaterThan(1);
      const joined = join(mkdtempSync(join(MEDIA, '..', 'joined-')), 'all.mp4');
      const { writeFileSync } = await import('node:fs');
      writeFileSync(joined, Buffer.concat([readFileSync(join(out, 'flac', 'init.mp4')), ...segs.map((s) => readFileSync(join(out, 'flac', s)))]));
      expect(await probe(joined)).toMatchObject({ codec: 'flac', sampleRate: 96000, bitDepth: 24 });
      rmSync(joined);
    });

    it('lossy originals are not lossless', async () => {
      expect((await probe(fx.mp3)).bitDepth).toBeNull();
    });

    it('hands out the lossless playlist only when asked for and available', async () => {
      const url = (id: string, q = '') =>
        as(listener)(http().get(`/api/tracks/${id}/stream-url${q}`)).expect(200).then((r) => r.body as { url: string; lossless: boolean });
      expect(await url(flacId)).toMatchObject({ url: expect.stringMatching(/\/master\.m3u8$/), lossless: false });
      expect(await url(flacId, '?quality=lossless')).toMatchObject({ url: expect.stringMatching(/\/lossless\.m3u8$/), lossless: true });
      expect(await url(mp3Id, '?quality=lossless')).toMatchObject({ url: expect.stringMatching(/\/master\.m3u8$/), lossless: false });
      await as(listener)(http().get(`/api/tracks/${flacId}/stream-url?quality=best`)).expect(400);
    });

    it('serves the FLAC files to the token holder, readable from any origin (Chromecast)', async () => {
      const { url } = (await as(listener)(http().get(`/api/tracks/${flacId}/stream-url?quality=lossless`)).expect(200)).body;
      const base = url.replace(/lossless\.m3u8$/, '');
      const master = await http().get(url).set('Origin', 'https://www.gstatic.com').expect(200);
      expect(master.headers['access-control-allow-origin']).toBe('*');
      expect(master.headers['access-control-allow-credentials']).toBeUndefined();
      expect(master.headers['cross-origin-resource-policy']).toBe('cross-origin');
      const playlist = await http().get(`${base}flac/index.m3u8`).expect(200);
      expect(playlist.text).toContain('#EXT-X-MAP:URI="init.mp4"');
      await http().get(`${base}flac/init.mp4`).expect(200).expect('Content-Type', 'audio/mp4');
      await http().get(`${base}flac/seg_000.m4s`).expect(200);
      await http().get(`${base}flac/../master.m3u8`).expect(404);
      await http().get(`${base}flac/init_0.mp4`).expect(404);
      // CORS preflight for a stream file is open; the API itself stays limited to the site.
      const pre = await http().options(`${base}flac/seg_000.m4s`).set('Origin', 'https://www.gstatic.com').set('Access-Control-Request-Method', 'GET');
      expect(pre.status).toBe(204);
      expect(pre.headers['access-control-allow-origin']).toBe('*');
      const api = await http().options('/api/home').set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
      expect(api.headers['access-control-allow-origin']).not.toBe('*');
      expect(api.headers['access-control-allow-origin']).not.toBe('https://evil.example');
    });

    it('marks lossless tracks in listings', async () => {
      const res = await as(listener)(http().get(`/api/albums/${om}`)).expect(200);
      const byTitle = Object.fromEntries(res.body.tracks.map((t: { title: string; lossless: boolean }) => [t.title, t.lossless]));
      expect(byTitle).toMatchObject({ 'Hi-res': true, Lossy: false });
    });
  });
});
