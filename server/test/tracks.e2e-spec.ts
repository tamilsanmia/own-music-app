import { INestApplication, INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { TranscodeQueue } from '../src/queue/transcode-queue';
import { TranscodeProcessor } from '../src/worker/transcode.processor';
import { WorkerModule } from '../src/worker/worker.module';
import { makeFixtures } from './fixtures';
import { adminToken, createListener, createTestApp, login, resetDb } from './helpers';

const MEDIA = process.env.MEDIA_ROOT!;
const ls = (sub: string) => (existsSync(join(MEDIA, sub)) ? readdirSync(join(MEDIA, sub)).sort() : []);

describe('Track upload and transcoding', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: TranscodeQueue;
  let admin: string;
  let listener: string;
  let fx: Awaited<ReturnType<typeof makeFixtures>>;
  let artistId: string;
  let albumId: string;
  const http = () => request(app.getHttpServer());
  const asAdmin = (r: request.Test) => r.set('Authorization', `Bearer ${admin}`);
  const asListener = (r: request.Test) => r.set('Authorization', `Bearer ${listener}`);

  function createTrack(body: Record<string, unknown>) {
    return asAdmin(http().post('/api/admin/tracks')).send({ albumId, ...body });
  }
  function putChunk(id: string, offset: number, bytes: Buffer) {
    return asAdmin(http().put(`/api/admin/tracks/${id}/upload?offset=${offset}`))
      .set('Content-Type', 'application/octet-stream')
      .send(bytes);
  }
  /** The full client flow: create, send chunks, complete. */
  async function upload(bytes: Buffer, filename = 'tone.wav', chunk = 300_000, extra: Record<string, unknown> = {}) {
    const created = await createTrack({ filename, sizeBytes: bytes.length, ...extra }).expect(201);
    const id = created.body.track.id as string;
    for (let off = 0; off < bytes.length; off += chunk) {
      await putChunk(id, off, bytes.subarray(off, off + chunk)).expect(200);
    }
    return { id, complete: () => asAdmin(http().post(`/api/admin/tracks/${id}/upload/complete`)) };
  }

  beforeAll(async () => {
    fx = await makeFixtures(join(MEDIA, '..', `fixtures-${process.pid}`));
    app = await createTestApp();
    prisma = app.get(PrismaService);
    queue = app.get(TranscodeQueue);
  });
  beforeEach(async () => {
    await resetDb(app);
    await queue.queue.obliterate({ force: true });
    for (const sub of ['originals', 'hls', 'tmp']) {
      for (const f of ls(sub)) rmSync(join(MEDIA, sub, f), { recursive: true, force: true });
    }
    admin = await adminToken(app);
    const l = await createListener(app, admin);
    listener = (await login(app, l.email, l.password)).body.accessToken;
    artistId = (await asAdmin(http().post('/api/admin/artists')).send({ name: 'Tone Generator' })).body.id;
    albumId = (await asAdmin(http().post('/api/admin/albums')).send({ title: 'Sine Waves', artistId })).body.id;
  });
  afterAll(async () => {
    await queue.queue.obliterate({ force: true });
    await app.close();
  });

  describe('upload (no worker running)', () => {
    it('creates a track with sensible defaults', async () => {
      const res = await createTrack({ filename: '07 A Sine Wave.WAV', sizeBytes: 1234 }).expect(201);
      expect(res.body.track).toMatchObject({
        title: '07 A Sine Wave',
        trackNumber: 1,
        status: 'UPLOADING',
        originalFilename: '07 A Sine Wave.WAV',
        sizeBytes: 1234,
        artist: { id: artistId, name: 'Tone Generator' },
      });
      expect(res.body.upload).toEqual({ chunkBytes: 4194304, maxChunkBytes: 16777216, receivedBytes: 0 });
      const row = await prisma.track.findUnique({ where: { id: res.body.track.id } });
      expect(row!.originalExt).toBe('wav');
    });

    it('gives parallel uploads to one album distinct track numbers', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => createTrack({ filename: `t${i}.mp3`, sizeBytes: 10 })),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
      expect(results.map((r) => r.body.track.trackNumber).sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it('accepts chunks, reports progress, and queues the track on completion', async () => {
      const { id, complete } = await upload(fx.wavBytes);
      const status = await asAdmin(http().get(`/api/admin/tracks/${id}/upload`)).expect(200);
      expect(status.body).toEqual({ status: 'UPLOADING', receivedBytes: fx.wavBytes.length, sizeBytes: fx.wavBytes.length });

      const done = await complete().expect(200);
      expect(done.body).toMatchObject({ status: 'PENDING', sourceInfo: 'pcm_s16le · 44.1 kHz · stereo' });
      expect(done.body.durationMs).toBeGreaterThanOrEqual(4990);

      expect(ls('originals')).toEqual([`${id}.wav`]);
      expect(readFileSync(join(MEDIA, 'originals', `${id}.wav`)).equals(fx.wavBytes)).toBe(true);
      expect(ls('tmp').filter((f) => f.startsWith(id))).toEqual([]);
      expect(await queue.isQueued(id)).toBe(true);

      await asAdmin(http().post(`/api/admin/tracks/${id}/upload/complete`)).expect(409);
      await putChunk(id, fx.wavBytes.length, Buffer.from('x')).expect(409);
    });

    it('rejects a chunk at the wrong offset and tells the client where to resume', async () => {
      const created = await createTrack({ filename: 'tone.wav', sizeBytes: fx.wavBytes.length }).expect(201);
      const id = created.body.track.id;
      await putChunk(id, 0, fx.wavBytes.subarray(0, 1000)).expect(200, { receivedBytes: 1000, sizeBytes: fx.wavBytes.length });

      const wrong = await putChunk(id, 0, fx.wavBytes.subarray(0, 1000)).expect(409);
      expect(wrong.body).toMatchObject({ receivedBytes: 1000 });
      await putChunk(id, 5000, fx.wavBytes.subarray(5000, 6000)).expect(409);

      await putChunk(id, 1000, fx.wavBytes.subarray(1000)).expect(200);
      await asAdmin(http().post(`/api/admin/tracks/${id}/upload/complete`)).expect(200);
    });

    it('rejects oversized chunks, wrong content types and early completion', async () => {
      const created = await createTrack({ filename: 'tone.wav', sizeBytes: 100 }).expect(201);
      const id = created.body.track.id;
      await putChunk(id, 0, Buffer.alloc(101)).expect(413);
      await asAdmin(http().put(`/api/admin/tracks/${id}/upload?offset=0`)).send({ some: 'json' }).expect(415);
      await asAdmin(http().put(`/api/admin/tracks/${id}/upload?offset=abc`))
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.alloc(1))
        .expect(400);
      await putChunk(id, 0, Buffer.alloc(40)).expect(200);
      const early = await asAdmin(http().post(`/api/admin/tracks/${id}/upload/complete`)).expect(409);
      expect(early.body.receivedBytes).toBe(40);
    });

    it('discards uploads that are not audio', async () => {
      const { id, complete } = await upload(fx.textBytes, 'notes.mp3');
      const res = await complete().expect(400);
      expect(res.body.message).toMatch(/Not a playable audio file/);
      await asAdmin(http().get(`/api/admin/tracks/${id}`)).expect(404);
      expect(ls('originals')).toEqual([]);
      expect(ls('tmp').filter((f) => f.startsWith(id))).toEqual([]);
    });

    it('validates the create request', async () => {
      await createTrack({ filename: 'x.mp3', sizeBytes: 1024 ** 3 + 1 }).expect(400);
      await createTrack({ filename: 'x.mp3', sizeBytes: 0 }).expect(400);
      await createTrack({ filename: '', sizeBytes: 10 }).expect(400);
      await asAdmin(http().post('/api/admin/tracks'))
        .send({ albumId: '00000000-0000-4000-8000-000000000000', filename: 'x.mp3', sizeBytes: 10 })
        .expect(400);
    });

    it('is admin-only', async () => {
      await asListener(http().post('/api/admin/tracks')).send({ albumId, filename: 'x.mp3', sizeBytes: 10 }).expect(403);
      const created = await createTrack({ filename: 'x.wav', sizeBytes: 10 }).expect(201);
      await asListener(http().put(`/api/admin/tracks/${created.body.track.id}/upload?offset=0`))
        .set('Content-Type', 'application/octet-stream')
        .send(Buffer.alloc(10))
        .expect(403);
      expect(ls('tmp').filter((f) => f.startsWith(created.body.track.id))).toEqual([]);
    });

    it('edits metadata and shows tracks in every state on the admin album page', async () => {
      const a = await createTrack({ filename: 'a.wav', sizeBytes: 10 }).expect(201);
      const b = await upload(fx.wavBytes, 'b.wav');
      await b.complete().expect(200);
      await asAdmin(http().patch(`/api/admin/tracks/${a.body.track.id}`)).send({ title: 'Renamed', trackNumber: 9 }).expect(200);

      const album = await asAdmin(http().get(`/api/admin/albums/${albumId}`)).expect(200);
      expect(album.body.tracks.map((t: { title: string; status: string }) => [t.title, t.status])).toEqual([
        ['b', 'PENDING'],
        ['Renamed', 'UPLOADING'],
      ]);
      // Listeners still see nothing: no track is READY.
      await asListener(http().get(`/api/albums/${albumId}`)).expect(404);
    });

    it('deleting a track removes its files and its queued job', async () => {
      const { id, complete } = await upload(fx.wavBytes);
      await complete().expect(200);
      await asAdmin(http().delete(`/api/admin/tracks/${id}`)).expect(204);
      expect(ls('originals')).toEqual([]);
      expect(await queue.isQueued(id)).toBe(false);
      await asAdmin(http().delete(`/api/admin/tracks/${id}`)).expect(404);
    });

    it('retry only applies to failed or pending tracks', async () => {
      const created = await createTrack({ filename: 'x.wav', sizeBytes: 10 }).expect(201);
      await asAdmin(http().post(`/api/admin/tracks/${created.body.track.id}/retry`)).expect(409);

      const { id, complete } = await upload(fx.wavBytes);
      await complete().expect(200);
      await prisma.track.update({ where: { id }, data: { status: 'FAILED', errorMessage: 'boom' } });
      await queue.remove(id);
      const res = await asAdmin(http().post(`/api/admin/tracks/${id}/retry`)).expect(200);
      expect(res.body).toMatchObject({ status: 'PENDING', errorMessage: null });
      expect(await queue.isQueued(id)).toBe(true);
    });
  });

  describe('with the worker running', () => {
    let worker: INestApplicationContext;

    beforeAll(async () => {
      worker = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    });
    afterAll(() => worker.close());

    async function waitForStatus(id: string, statuses: string[], timeoutMs = 60_000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const t = await prisma.track.findUnique({ where: { id } });
        if (t && statuses.includes(t.status)) return t;
        if (Date.now() > deadline) throw new Error(`track ${id} still ${t?.status}`);
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    jest.setTimeout(90_000);

    it('transcodes an upload to HLS and makes it visible to listeners', async () => {
      const { id, complete } = await upload(fx.wavBytes, '01 Concert A.wav');
      await complete().expect(200);
      const track = await waitForStatus(id, ['READY', 'FAILED']);
      expect([track.status, track.errorMessage]).toEqual(['READY', null]);

      expect(ls(`hls/${id}`)).toEqual(['160k', '320k', '96k', 'master.m3u8']);
      const master = readFileSync(join(MEDIA, 'hls', id, 'master.m3u8'), 'utf8');
      expect(master.match(/#EXT-X-STREAM-INF/g)).toHaveLength(3);
      expect(ls('tmp').filter((f) => f.includes(id))).toEqual([]);

      const album = await asListener(http().get(`/api/albums/${albumId}`)).expect(200);
      expect(album.body.tracks).toEqual([
        expect.objectContaining({ id, title: '01 Concert A', trackNumber: 1, durationMs: track.durationMs }),
      ]);
      const home = await asListener(http().get('/api/home')).expect(200);
      expect(home.body.newAlbums.map((a: { id: string }) => a.id)).toEqual([albumId]);
    });

    it('marks a track FAILED with the ffmpeg error when transcoding fails for good', async () => {
      // A PENDING track whose stored original is not audio (as if it got corrupted on disk),
      // queued directly with a single attempt so the test doesn't wait for retry backoff.
      const { id } = await prisma.track.create({
        data: { title: 'Broken', albumId, artistId, trackNumber: 1, status: 'PENDING', originalExt: 'mp3' },
      });
      copyFileSync(fx.text, join(MEDIA, 'originals', `${id}.mp3`));
      await queue.queue.add('transcode', { trackId: id }, { jobId: id, attempts: 1, removeOnComplete: true, removeOnFail: true });

      const failed = await waitForStatus(id, ['FAILED', 'READY']);
      expect(failed.status).toBe('FAILED');
      expect(failed.errorMessage).toMatch(/^ffmpeg exited with code \d+: /);
      expect(failed.errorMessage).not.toContain(MEDIA); // no server paths in admin-facing errors
      expect(existsSync(join(MEDIA, 'hls', id))).toBe(false);
      expect(ls('tmp').filter((f) => f.includes(id))).toEqual([]);
    });

    it('re-queues pending tracks whose job was lost', async () => {
      const { id, complete } = await upload(fx.wavBytes);
      await complete().expect(200);
      await queue.remove(id); // e.g. Redis restarted and lost the job
      // The job may already be running; either way the track must end up READY.
      await worker.get(TranscodeProcessor).reconcile(true);
      expect((await waitForStatus(id, ['READY', 'FAILED'])).status).toBe('READY');
    });
  });
});
