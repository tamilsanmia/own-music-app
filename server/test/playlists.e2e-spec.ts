import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { adminToken, createListener, createTestApp, login, resetDb } from './helpers';

describe('Playlists', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ann: string;
  let bob: string;
  let t: string[]; // READY track ids
  let pending: string;
  const http = () => request(app.getHttpServer());
  const as = (token: string, r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const titles = (body: { items: { track: { title: string } }[] }) => body.items.map((i) => i.track.title);

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
    const artist = await prisma.artist.create({ data: { name: 'Deva' } });
    const album = await prisma.album.create({ data: { title: 'Kushi', artistId: artist.id, coverId: '11111111-1111-4111-8111-111111111111' } });
    t = [];
    for (const [n, title] of ['A', 'B', 'C', 'D'].entries()) {
      t.push((await prisma.track.create({ data: { title, albumId: album.id, artistId: artist.id, trackNumber: n + 1, status: 'READY' } })).id);
    }
    pending = (await prisma.track.create({ data: { title: 'P', albumId: album.id, artistId: artist.id, trackNumber: 9, status: 'PENDING' } })).id;
  });
  afterAll(() => app.close());

  async function playlistWith(trackIds: string[], token = ann) {
    const p = (await as(token, http().post('/api/me/playlists')).send({ name: '  Road Trip ' }).expect(201)).body;
    if (trackIds.length) await as(token, http().post(`/api/me/playlists/${p.id}/tracks`)).send({ trackIds }).expect(201);
    return p.id as string;
  }
  const get = (id: string, token = ann) => as(token, http().get(`/api/me/playlists/${id}`));

  it('creates, renames, lists and deletes a playlist', async () => {
    const id = await playlistWith([t[0], t[1]]);
    await as(ann, http().patch(`/api/me/playlists/${id}`)).send({ name: 'Drive', description: 'Night songs' }).expect(200);
    const list = await as(ann, http().get('/api/me/playlists')).expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({ id, name: 'Drive', description: 'Night songs', trackCount: 2, covers: [{ small: expect.stringMatching(/-300\.webp$/), large: expect.any(String) }] }),
    ]);
    await as(ann, http().delete(`/api/me/playlists/${id}`)).expect(204);
    await get(id).expect(404);
    expect(await prisma.track.count()).toBe(5); // tracks are untouched
  });

  it('appends in order, allows duplicates, and skips unplayable tracks', async () => {
    const id = await playlistWith([t[2], t[0]]);
    const res = await as(ann, http().post(`/api/me/playlists/${id}/tracks`)).send({ trackIds: [t[0], pending] }).expect(201);
    expect(res.body).toEqual({ added: 1, skipped: 1 });
    const p = await get(id).expect(200);
    expect(titles(p.body)).toEqual(['C', 'A', 'A']);
    expect(p.body.items[0].track).toMatchObject({ title: 'C', album: { title: 'Kushi' }, artist: { name: 'Deva' } });
    await as(ann, http().post(`/api/me/playlists/${id}/tracks`)).send({ trackIds: [pending] }).expect(404);
    await as(ann, http().post(`/api/me/playlists/${id}/tracks`)).send({ trackIds: [] }).expect(400);
  });

  it('keeps positions distinct when songs are added at the same time', async () => {
    const id = await playlistWith([]);
    await Promise.all(t.map((trackId) => as(ann, http().post(`/api/me/playlists/${id}/tracks`)).send({ trackIds: [trackId] })));
    const rows = await prisma.playlistTrack.findMany({ where: { playlistId: id }, orderBy: { position: 'asc' } });
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3]);
  });

  it('moves a song up and down', async () => {
    const id = await playlistWith(t);
    const items = (await get(id)).body.items;
    let res = await as(ann, http().post(`/api/me/playlists/${id}/move`)).send({ itemId: items[3].itemId, toIndex: 0 }).expect(200);
    expect(titles(res.body)).toEqual(['D', 'A', 'B', 'C']);
    res = await as(ann, http().post(`/api/me/playlists/${id}/move`)).send({ itemId: items[3].itemId, toIndex: 99 }).expect(200);
    expect(titles(res.body)).toEqual(['A', 'B', 'C', 'D']);
    res = await as(ann, http().post(`/api/me/playlists/${id}/move`)).send({ itemId: items[0].itemId, toIndex: 2 }).expect(200);
    expect(titles(res.body)).toEqual(['B', 'C', 'A', 'D']);
    const rows = await prisma.playlistTrack.findMany({ where: { playlistId: id }, orderBy: { position: 'asc' } });
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3]);
  });

  it('removes one entry of a duplicated song and closes the gap', async () => {
    const id = await playlistWith([t[0], t[1], t[0], t[2]]);
    const items = (await get(id)).body.items;
    const res = await as(ann, http().delete(`/api/me/playlists/${id}/tracks/${items[2].itemId}`)).expect(200);
    expect(titles(res.body)).toEqual(['A', 'B', 'C']);
    const rows = await prisma.playlistTrack.findMany({ where: { playlistId: id }, orderBy: { position: 'asc' } });
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
    await as(ann, http().delete(`/api/me/playlists/${id}/tracks/${items[2].itemId}`)).expect(404);
  });

  it('only the owner can see or change a playlist', async () => {
    const id = await playlistWith([t[0]]);
    const itemId = (await get(id)).body.items[0].itemId;
    await get(id, bob).expect(404);
    await as(bob, http().patch(`/api/me/playlists/${id}`)).send({ name: 'Mine now' }).expect(404);
    await as(bob, http().post(`/api/me/playlists/${id}/tracks`)).send({ trackIds: [t[1]] }).expect(404);
    await as(bob, http().post(`/api/me/playlists/${id}/move`)).send({ itemId, toIndex: 0 }).expect(404);
    await as(bob, http().delete(`/api/me/playlists/${id}/tracks/${itemId}`)).expect(404);
    await as(bob, http().delete(`/api/me/playlists/${id}`)).expect(404);
    await as(bob, http().get('/api/me/playlists')).expect(200, []);
    expect(titles((await get(id)).body)).toEqual(['A']);
    await http().get(`/api/me/playlists/${id}`).expect(401);
  });

  it('hides songs that stop being playable and drops deleted ones', async () => {
    const id = await playlistWith([t[0], t[1]]);
    await prisma.track.update({ where: { id: t[0] }, data: { status: 'FAILED' } });
    expect(titles((await get(id)).body)).toEqual(['B']);
    await prisma.track.delete({ where: { id: t[1] } });
    expect((await get(id)).body.trackCount).toBe(0);
  });

  it('validates input', async () => {
    await as(ann, http().post('/api/me/playlists')).send({ name: '' }).expect(400);
    await as(ann, http().post('/api/me/playlists')).send({ name: 'x'.repeat(101) }).expect(400);
    const id = await playlistWith([]);
    await as(ann, http().post(`/api/me/playlists/${id}/tracks`)).send({ trackIds: ['nope'] }).expect(400);
    await as(ann, http().post(`/api/me/playlists/${id}/move`)).send({ itemId: t[0], toIndex: -1 }).expect(400);
  });
});
