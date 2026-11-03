import { INestApplication } from '@nestjs/common';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { adminToken, createListener, createTestApp, login, resetDb } from './helpers';

const MEDIA_ROOT = process.env.MEDIA_ROOT!;
const coverFiles = () => readdirSync(join(MEDIA_ROOT, 'covers')).sort();

function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#1ed760' } }).png().toBuffer();
}

describe('Catalog', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: string;
  let listener: string;
  const http = () => request(app.getHttpServer());
  const asAdmin = (r: request.Test) => r.set('Authorization', `Bearer ${admin}`);
  const asListener = (r: request.Test) => r.set('Authorization', `Bearer ${listener}`);

  async function createArtist(name = 'Nina Simone') {
    return (await asAdmin(http().post('/api/admin/artists')).send({ name }).expect(201)).body;
  }
  async function createAlbum(artistId: string, title = 'Pastel Blues', releaseYear?: number) {
    return (await asAdmin(http().post('/api/admin/albums')).send({ title, artistId, releaseYear }).expect(201)).body;
  }
  async function addTrack(albumId: string, artistId: string, trackNumber: number, status: 'READY' | 'PENDING') {
    return prisma.track.create({
      data: { title: `Track ${trackNumber}`, albumId, artistId, trackNumber, status, durationMs: 180_000 },
    });
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetDb(app);
    for (const f of coverFiles()) await import('node:fs/promises').then((fs) => fs.rm(join(MEDIA_ROOT, 'covers', f)));
    admin = await adminToken(app);
    const l = await createListener(app, admin);
    listener = (await login(app, l.email, l.password)).body.accessToken;
  });
  afterAll(() => app.close());

  describe('access control', () => {
    it('requires login for catalog reads', async () => {
      await http().get('/api/home').expect(401);
      await http().get('/api/artists').expect(401);
    });

    it('forbids catalog writes to listeners', async () => {
      await asListener(http().post('/api/admin/artists')).send({ name: 'X' }).expect(403);
      await asListener(http().get('/api/admin/albums')).expect(403);
      const artist = await createArtist();
      await asListener(http().put(`/api/admin/artists/${artist.id}/image`))
        .attach('image', await png(10, 10), 'a.png')
        .expect(403);
    });
  });

  describe('artists (admin)', () => {
    it('creates, updates, lists and deletes', async () => {
      const artist = await createArtist('  Nina Simone  ');
      expect(artist).toEqual({ id: expect.any(String), name: 'Nina Simone', bio: null, image: null });

      const updated = await asAdmin(http().patch(`/api/admin/artists/${artist.id}`))
        .send({ bio: 'High Priestess of Soul' })
        .expect(200);
      expect(updated.body).toMatchObject({ name: 'Nina Simone', bio: 'High Priestess of Soul' });

      await asAdmin(http().patch(`/api/admin/artists/${artist.id}`)).send({ bio: null }).expect(200, {
        ...updated.body,
        bio: null,
      });

      const list = await asAdmin(http().get('/api/admin/artists')).expect(200);
      expect(list.body).toEqual({ items: [{ ...updated.body, bio: null, albumCount: 0, trackCount: 0 }], total: 1 });

      await asAdmin(http().delete(`/api/admin/artists/${artist.id}`)).expect(204);
      await asAdmin(http().delete(`/api/admin/artists/${artist.id}`)).expect(404);
    });

    it('validates input', async () => {
      await asAdmin(http().post('/api/admin/artists')).send({ name: '   ' }).expect(400);
      await asAdmin(http().post('/api/admin/artists')).send({ name: 'x'.repeat(201) }).expect(400);
      await asAdmin(http().post('/api/admin/artists')).send({ name: 'Ok', imageId: 'hack' }).expect(400);
      await asAdmin(http().patch('/api/admin/artists/not-a-uuid')).send({ name: 'x' }).expect(400);
    });

    it('refuses to delete an artist that still has albums', async () => {
      const artist = await createArtist();
      await createAlbum(artist.id);
      await asAdmin(http().delete(`/api/admin/artists/${artist.id}`)).expect(409);
    });
  });

  describe('albums (admin)', () => {
    it('creates, updates, lists by artist and deletes', async () => {
      const a1 = await createArtist('A1');
      const a2 = await createArtist('A2');
      const album = await createAlbum(a1.id, 'First', 1965);
      expect(album).toMatchObject({ title: 'First', releaseYear: 1965, artist: { id: a1.id, name: 'A1' }, cover: null });

      const moved = await asAdmin(http().patch(`/api/admin/albums/${album.id}`))
        .send({ artistId: a2.id, releaseYear: null })
        .expect(200);
      expect(moved.body).toMatchObject({ artist: { id: a2.id }, releaseYear: null });

      await createAlbum(a1.id, 'Second');
      const byA2 = await asAdmin(http().get(`/api/admin/albums?artistId=${a2.id}`)).expect(200);
      expect(byA2.body.items.map((a: { title: string }) => a.title)).toEqual(['First']);
      expect(byA2.body.items[0].trackCount).toBe(0);
      const all = await asAdmin(http().get('/api/admin/albums?limit=1')).expect(200);
      expect(all.body).toMatchObject({ total: 2, items: [{ title: 'Second' }] });

      await asAdmin(http().delete(`/api/admin/albums/${album.id}`)).expect(204);
    });

    it('rejects an unknown artist and bad years', async () => {
      await asAdmin(http().post('/api/admin/albums'))
        .send({ title: 'X', artistId: '00000000-0000-4000-8000-000000000000' })
        .expect(400);
      const artist = await createArtist();
      await asAdmin(http().post('/api/admin/albums')).send({ title: 'X', artistId: artist.id, releaseYear: 99 }).expect(400);
      await asAdmin(http().get('/api/admin/albums?limit=500')).expect(400);
    });

    it('refuses to delete an album that has tracks', async () => {
      const artist = await createArtist();
      const album = await createAlbum(artist.id);
      await addTrack(album.id, artist.id, 1, 'PENDING');
      await asAdmin(http().delete(`/api/admin/albums/${album.id}`)).expect(409);
    });
  });

  describe('cover images', () => {
    it('stores 300px and 600px square WebP files and serves them publicly with long caching', async () => {
      const artist = await createArtist();
      const album = await createAlbum(artist.id);
      const res = await asAdmin(http().put(`/api/admin/albums/${album.id}/cover`))
        .attach('image', await png(1600, 900), 'cover.png')
        .expect(200);

      expect(res.body.cover).toEqual({
        small: expect.stringMatching(/^\/media\/covers\/[0-9a-f-]{36}-300\.webp$/),
        large: expect.stringMatching(/^\/media\/covers\/[0-9a-f-]{36}-600\.webp$/),
      });
      expect(coverFiles()).toHaveLength(2);

      for (const [url, size] of [[res.body.cover.small, 300], [res.body.cover.large, 600]] as const) {
        const file = await http().get(url).buffer(true).parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        }).expect(200); // no Authorization header
        expect(file.headers['content-type']).toBe('image/webp');
        expect(file.headers['cache-control']).toMatch(/max-age=31536000.*immutable/);
        const meta = await sharp(file.body as Buffer).metadata();
        expect([meta.format, meta.width, meta.height]).toEqual(['webp', size, size]);
      }
    });

    it('replacing a cover deletes the old files', async () => {
      const artist = await createArtist();
      const album = await createAlbum(artist.id);
      const first = (await asAdmin(http().put(`/api/admin/albums/${album.id}/cover`)).attach('image', await png(50, 50), 'a.png')).body;
      const second = (await asAdmin(http().put(`/api/admin/albums/${album.id}/cover`)).attach('image', await png(60, 60), 'b.png')).body;

      expect(second.cover.large).not.toBe(first.cover.large);
      expect(coverFiles()).toHaveLength(2);
      await http().get(first.cover.large).expect(404);
      await http().get(second.cover.large).expect(200);
    });

    it('rejects files that are not raster images and writes nothing', async () => {
      const artist = await createArtist();
      const album = await createAlbum(artist.id);
      const put = () => asAdmin(http().put(`/api/admin/albums/${album.id}/cover`));

      await put().attach('image', Buffer.from('definitely not an image'), 'evil.png').expect(400);
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
      await put().attach('image', svg, 'cover.svg').expect(400);
      await put().attach('wrongfield', await png(10, 10), 'a.png').expect(400);
      await put().expect(400);
      await put().attach('image', Buffer.alloc(10 * 1024 * 1024 + 1), 'huge.png').expect(413);

      expect(coverFiles()).toEqual([]);
      const row = await prisma.album.findUnique({ where: { id: album.id } });
      expect(row!.coverId).toBeNull();
    });

    it('deleting an album or its cover removes the files', async () => {
      const artist = await createArtist();
      const a = await createAlbum(artist.id, 'A');
      const b = await createAlbum(artist.id, 'B');
      await asAdmin(http().put(`/api/admin/albums/${a.id}/cover`)).attach('image', await png(20, 20), 'a.png').expect(200);
      await asAdmin(http().put(`/api/admin/albums/${b.id}/cover`)).attach('image', await png(20, 20), 'b.png').expect(200);
      expect(coverFiles()).toHaveLength(4);

      await asAdmin(http().delete(`/api/admin/albums/${a.id}`)).expect(204);
      expect(coverFiles()).toHaveLength(2);

      const res = await asAdmin(http().delete(`/api/admin/albums/${b.id}/cover`)).expect(200);
      expect(res.body.cover).toBeNull();
      expect(coverFiles()).toEqual([]);
    });

    it('artist images work the same way and are removed with the artist', async () => {
      const artist = await createArtist();
      const res = await asAdmin(http().put(`/api/admin/artists/${artist.id}/image`))
        .attach('image', await png(800, 800), 'nina.png')
        .expect(200);
      expect(res.body.image.large).toMatch(/-600\.webp$/);
      await asAdmin(http().delete(`/api/admin/artists/${artist.id}`)).expect(204);
      expect(coverFiles()).toEqual([]);
    });

    it('serves nothing outside the covers directory', async () => {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(join(MEDIA_ROOT, 'originals'), { recursive: true });
      writeFileSync(join(MEDIA_ROOT, 'originals', 'song.mp3'), 'audio');
      await http().get('/media/originals/song.mp3').expect(404);
      await http().get('/media/covers/../originals/song.mp3').expect(404);
      await http().get('/media/covers/%2e%2e/originals/song.mp3').expect(404);
      await http().get('/media/covers/').expect(404);
      expect(existsSync(join(MEDIA_ROOT, 'originals', 'song.mp3'))).toBe(true);
    });
  });

  describe('listener reads', () => {
    async function seed() {
      const nina = await createArtist('Nina Simone');
      const empty = await createArtist('Unreleased Band');
      const old = await createAlbum(nina.id, 'Pastel Blues', 1965);
      const newer = await createAlbum(nina.id, 'Wild Is the Wind', 1966);
      const draft = await createAlbum(nina.id, 'Still Uploading');
      await createAlbum(empty.id, 'Nothing Yet');
      await addTrack(old.id, nina.id, 2, 'READY');
      await addTrack(old.id, nina.id, 1, 'READY');
      await addTrack(old.id, nina.id, 3, 'PENDING');
      await addTrack(newer.id, nina.id, 1, 'READY');
      await addTrack(draft.id, nina.id, 1, 'PENDING');
      return { nina, empty, old, newer, draft };
    }

    it('home lists only albums with playable tracks, newest first', async () => {
      await seed();
      const res = await asListener(http().get('/api/home')).expect(200);
      expect(res.body.newAlbums.map((a: { title: string }) => a.title)).toEqual(['Wild Is the Wind', 'Pastel Blues']);
      expect(res.body.newAlbums[0]).toMatchObject({ artist: { name: 'Nina Simone' }, cover: null, releaseYear: 1966 });
    });

    it('album detail shows ready tracks in order and hides unplayable albums', async () => {
      const { old, draft } = await seed();
      const res = await asListener(http().get(`/api/albums/${old.id}`)).expect(200);
      expect(res.body.tracks.map((t: { trackNumber: number }) => t.trackNumber)).toEqual([1, 2]);
      expect(res.body.tracks[0]).toEqual({
        id: expect.any(String),
        title: 'Track 1',
        trackNumber: 1,
        durationMs: 180000,
        artist: { id: expect.any(String), name: 'Nina Simone' },
      });
      await asListener(http().get(`/api/albums/${draft.id}`)).expect(404);
      await asListener(http().get('/api/albums/00000000-0000-4000-8000-000000000000')).expect(404);
    });

    it('artists list and detail only include playable music', async () => {
      const { nina, empty } = await seed();
      const list = await asListener(http().get('/api/artists')).expect(200);
      expect(list.body).toEqual({ items: [{ id: nina.id, name: 'Nina Simone', bio: null, image: null }], total: 1 });

      const detail = await asListener(http().get(`/api/artists/${nina.id}`)).expect(200);
      expect(detail.body.albums.map((a: { title: string }) => a.title)).toEqual(['Wild Is the Wind', 'Pastel Blues']);
      await asListener(http().get(`/api/artists/${empty.id}`)).expect(404);
    });
  });
});
