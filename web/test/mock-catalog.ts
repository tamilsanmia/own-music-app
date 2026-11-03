import { http, HttpResponse } from 'msw';
import type { AdminTrack, Album, Artist, TrackStatus } from '@/admin/catalogApi';
import { db as authDb } from './mock-api';

/** In-memory fake of the admin catalog and chunked-upload API. */
export const cat = {
  artists: [] as Artist[],
  albums: [] as (Omit<Album, 'artist'> & { artistId: string })[],
  tracks: [] as (AdminTrack & { received: number })[],
  chunkBytes: 4,
  calls: {
    chunks: [] as { name: string; offset: number; size: number }[],
    getAlbum: 0,
    retry: [] as string[],
    deleted: [] as string[],
    streamUrl: [] as string[],
    search: [] as string[],
    plays: [] as string[],
  },
  /** userId -> liked track ids, newest first. */
  likes: new Map<string, string[]>(),
  /** userId -> [trackId, playedAt ms] newest last. */
  history: new Map<string, [string, number][]>(),
  failLikes: false,
  /** Lifetime of stream URLs handed out by the mock. */
  streamTtlMs: 6 * 3600_000,
  /** Called on every GET /api/admin/albums/:id, so tests can move tracks through states. */
  onAlbumGet: undefined as undefined | ((n: number) => void),
};

let seq = 0;
const now = '2026-11-01T10:00:00.000Z';

export function resetCatalog(): void {
  cat.artists = [];
  cat.albums = [];
  cat.tracks = [];
  cat.chunkBytes = 4;
  cat.calls = { chunks: [], getAlbum: 0, retry: [], deleted: [], streamUrl: [], search: [], plays: [] };
  cat.likes = new Map();
  cat.history = new Map();
  cat.failLikes = false;
  cat.streamTtlMs = 6 * 3600_000;
  cat.onAlbumGet = undefined;
}

export function seedAlbum() {
  const artist: Artist = { id: `ar-${++seq}`, name: 'Nina Simone', bio: null, image: null };
  const album = { id: `al-${++seq}`, title: 'Pastel Blues', releaseYear: 1965, artistId: artist.id, cover: null, createdAt: now };
  cat.artists.push(artist);
  cat.albums.push(album);
  return { artist, album };
}

export function seedTrack(
  albumId: string,
  title: string,
  status: TrackStatus,
  extra: Partial<AdminTrack & { received: number }> = {},
) {
  const album = cat.albums.find((a) => a.id === albumId)!;
  const artist = cat.artists.find((a) => a.id === album.artistId)!;
  const track = {
    id: `tr-${++seq}`,
    title,
    albumId,
    trackNumber: cat.tracks.filter((t) => t.albumId === albumId).length + 1,
    durationMs: 185_000,
    status,
    errorMessage: null,
    originalFilename: `${title}.mp3`,
    sizeBytes: 10,
    sourceInfo: 'mp3 · 44.1 kHz · stereo',
    artist: { id: artist.id, name: artist.name },
    createdAt: now,
    updatedAt: now,
    received: 10,
    ...extra,
  };
  cat.tracks.push(track);
  return track;
}

function isAdmin(request: Request): boolean {
  const id = request.headers.get('authorization')?.replace(/^Bearer at-/, '');
  return authDb.users.some((u) => u.id === id && u.role === 'ADMIN' && u.isActive);
}
const deny = () => HttpResponse.json({ message: 'Unauthorized' }, { status: 401 });
const notFound = () => HttpResponse.json({ message: 'Not Found' }, { status: 404 });
const publicTrack = ({ received: _r, ...t }: AdminTrack & { received: number }): AdminTrack => t;
function presentAlbum(a: (typeof cat.albums)[number]): Album {
  const artist = cat.artists.find((x) => x.id === a.artistId)!;
  const { artistId: _id, ...rest } = a;
  return { ...rest, artist: { id: artist.id, name: artist.name } };
}
const counts = (artistId: string) => ({
  albumCount: cat.albums.filter((a) => a.artistId === artistId).length,
  trackCount: cat.tracks.filter((t) => t.artist.id === artistId).length,
});

const readyTracks = (albumId: string) =>
  cat.tracks
    .filter((t) => t.albumId === albumId && t.status === 'READY')
    .sort((a, b) => a.trackNumber - b.trackNumber)
    .map((t) => ({ id: t.id, title: t.title, trackNumber: t.trackNumber, durationMs: t.durationMs, artist: t.artist }));
function withAlbum(id: string) {
  const t = cat.tracks.find((x) => x.id === id && x.status === 'READY');
  if (!t) return undefined;
  const al = cat.albums.find((a) => a.id === t.albumId)!;
  return {
    id: t.id,
    title: t.title,
    trackNumber: t.trackNumber,
    durationMs: t.durationMs,
    artist: t.artist,
    album: { id: al.id, title: al.title, cover: al.cover },
  };
}
const callerId = (request: Request) => request.headers.get('authorization')?.replace(/^Bearer at-/, '') ?? '';
const visibleAlbums = () => cat.albums.filter((a) => readyTracks(a.id).length > 0);
const isUser = (request: Request) => {
  const id = request.headers.get('authorization')?.replace(/^Bearer at-/, '');
  return authDb.users.some((u) => u.id === id && u.isActive);
};

/** Listener endpoints: only READY tracks, as on the real server. */
export const listenerHandlers = [
  http.get('*/api/home', ({ request }) => {
    if (!isUser(request)) return deny();
    return HttpResponse.json({ newAlbums: [...visibleAlbums()].reverse().map(presentAlbum) });
  }),
  http.get('*/api/albums/:id', ({ request, params }) => {
    if (!isUser(request)) return deny();
    const a = visibleAlbums().find((x) => x.id === params.id);
    return a ? HttpResponse.json({ ...presentAlbum(a), tracks: readyTracks(a.id) }) : notFound();
  }),
  http.get('*/api/artists/:id', ({ request, params }) => {
    if (!isUser(request)) return deny();
    const artist = cat.artists.find((x) => x.id === params.id);
    const albums = visibleAlbums().filter((a) => a.artistId === params.id);
    return artist && albums.length ? HttpResponse.json({ ...artist, albums: albums.map(presentAlbum) }) : notFound();
  }),
  http.get('*/api/tracks/:id/stream-url', ({ request, params }) => {
    if (!isUser(request)) return deny();
    const t = cat.tracks.find((x) => x.id === params.id && x.status === 'READY');
    if (!t) return notFound();
    cat.calls.streamUrl.push(t.id);
    const n = cat.calls.streamUrl.length;
    return HttpResponse.json({
      url: `/stream/tok${n}/${t.id}/master.m3u8`,
      expiresAt: new Date(Date.now() + cat.streamTtlMs).toISOString(),
    });
  }),
];

/** Search, likes and history, with simple substring matching instead of trigram ranking. */
export const libraryHandlers = [
  http.get('*/api/search', ({ request }) => {
    if (!isUser(request)) return deny();
    const q = new URL(request.url).searchParams.get('q')!.toLowerCase();
    cat.calls.search.push(q);
    const hit = (s: string) => s.toLowerCase().includes(q);
    const tracks = cat.tracks.filter((t) => t.status === 'READY' && (hit(t.title) || hit(t.artist.name))).map((t) => withAlbum(t.id)!);
    const albums = visibleAlbums().filter((a) => hit(a.title)).map(presentAlbum);
    const artists = cat.artists.filter((a) => hit(a.name) && cat.tracks.some((t) => t.artist.id === a.id && t.status === 'READY'));
    return HttpResponse.json({ tracks, albums, artists });
  }),
  http.get('*/api/me/likes/ids', ({ request }) => {
    if (!isUser(request)) return deny();
    return HttpResponse.json(cat.likes.get(callerId(request)) ?? []);
  }),
  http.get('*/api/me/likes', ({ request }) => {
    if (!isUser(request)) return deny();
    const items = (cat.likes.get(callerId(request)) ?? []).map(withAlbum).filter(Boolean);
    return HttpResponse.json({ items, total: items.length });
  }),
  http.put('*/api/me/likes/:id', ({ request, params }) => {
    if (!isUser(request)) return deny();
    if (cat.failLikes) return HttpResponse.json({ message: 'Server error' }, { status: 500 });
    const id = String(params.id);
    const list = cat.likes.get(callerId(request)) ?? [];
    cat.likes.set(callerId(request), [id, ...list.filter((x) => x !== id)]);
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete('*/api/me/likes/:id', ({ request, params }) => {
    if (!isUser(request)) return deny();
    cat.likes.set(callerId(request), (cat.likes.get(callerId(request)) ?? []).filter((x) => x !== params.id));
    return new HttpResponse(null, { status: 204 });
  }),
  http.post('*/api/me/history', async ({ request }) => {
    if (!isUser(request)) return deny();
    const { trackId } = (await request.json()) as { trackId: string };
    cat.calls.plays.push(trackId);
    const list = cat.history.get(callerId(request)) ?? [];
    list.push([trackId, Date.now()]);
    cat.history.set(callerId(request), list);
    return new HttpResponse(null, { status: 204 });
  }),
  http.get('*/api/me/recent', ({ request }) => {
    if (!isUser(request)) return deny();
    const seen = new Set<string>();
    const items = [...(cat.history.get(callerId(request)) ?? [])]
      .reverse()
      .filter(([id]) => !seen.has(id) && seen.add(id))
      .map(([id]) => withAlbum(id))
      .filter(Boolean);
    return HttpResponse.json({ items });
  }),
];

export const catalogHandlers = [
  ...libraryHandlers,
  ...listenerHandlers,
  http.get('*/api/admin/artists', ({ request }) => {
    if (!isAdmin(request)) return deny();
    return HttpResponse.json({ items: cat.artists.map((a) => ({ ...a, ...counts(a.id) })), total: cat.artists.length });
  }),
  http.get('*/api/admin/artists/:id', ({ request, params }) => {
    if (!isAdmin(request)) return deny();
    const a = cat.artists.find((x) => x.id === params.id);
    return a ? HttpResponse.json({ ...a, ...counts(a.id) }) : notFound();
  }),
  http.post('*/api/admin/artists', async ({ request }) => {
    if (!isAdmin(request)) return deny();
    const body = (await request.json()) as { name: string; bio?: string };
    const artist: Artist = { id: `ar-${++seq}`, name: body.name, bio: body.bio ?? null, image: null };
    cat.artists.push(artist);
    return HttpResponse.json(artist, { status: 201 });
  }),

  http.get('*/api/admin/albums', ({ request }) => {
    if (!isAdmin(request)) return deny();
    const artistId = new URL(request.url).searchParams.get('artistId');
    const items = cat.albums
      .filter((a) => !artistId || a.artistId === artistId)
      .map((a) => ({ ...presentAlbum(a), trackCount: cat.tracks.filter((t) => t.albumId === a.id).length }));
    return HttpResponse.json({ items, total: items.length });
  }),
  http.get('*/api/admin/albums/:id', ({ request, params }) => {
    if (!isAdmin(request)) return deny();
    cat.calls.getAlbum += 1;
    cat.onAlbumGet?.(cat.calls.getAlbum);
    const a = cat.albums.find((x) => x.id === params.id);
    if (!a) return notFound();
    const tracks = cat.tracks
      .filter((t) => t.albumId === a.id)
      .sort((x, y) => x.trackNumber - y.trackNumber)
      .map(publicTrack);
    return HttpResponse.json({ ...presentAlbum(a), tracks });
  }),

  http.post('*/api/admin/tracks', async ({ request }) => {
    if (!isAdmin(request)) return deny();
    const body = (await request.json()) as { albumId: string; filename: string; sizeBytes: number };
    const t = seedTrack(body.albumId, body.filename.replace(/\.[^.]+$/, ''), 'UPLOADING', {
      originalFilename: body.filename,
      sizeBytes: body.sizeBytes,
      durationMs: null,
      sourceInfo: null,
      received: 0,
    });
    return HttpResponse.json(
      { track: publicTrack(t), upload: { chunkBytes: cat.chunkBytes, maxChunkBytes: 16, receivedBytes: 0 } },
      { status: 201 },
    );
  }),
  http.get('*/api/admin/tracks/:id/upload', ({ request, params }) => {
    if (!isAdmin(request)) return deny();
    const t = cat.tracks.find((x) => x.id === params.id);
    return t ? HttpResponse.json({ status: t.status, receivedBytes: t.received, sizeBytes: t.sizeBytes }) : notFound();
  }),
  http.put('*/api/admin/tracks/:id/upload', async ({ request, params }) => {
    if (!isAdmin(request)) return deny();
    const t = cat.tracks.find((x) => x.id === params.id);
    if (!t) return notFound();
    const offset = Number(new URL(request.url).searchParams.get('offset'));
    if (offset !== t.received) {
      return HttpResponse.json({ message: 'Offset does not match', receivedBytes: t.received }, { status: 409 });
    }
    const size = (await request.arrayBuffer()).byteLength;
    cat.calls.chunks.push({ name: t.originalFilename!, offset, size });
    t.received += size;
    return HttpResponse.json({ receivedBytes: t.received, sizeBytes: t.sizeBytes });
  }),
  http.post('*/api/admin/tracks/:id/upload/complete', ({ request, params }) => {
    if (!isAdmin(request)) return deny();
    const t = cat.tracks.find((x) => x.id === params.id);
    if (!t) return notFound();
    if (t.received !== t.sizeBytes) return HttpResponse.json({ message: 'Not finished', receivedBytes: t.received }, { status: 409 });
    Object.assign(t, { status: 'PENDING', durationMs: 180_000, sourceInfo: 'mp3 · 44.1 kHz · stereo' });
    return HttpResponse.json(publicTrack(t));
  }),
  http.post('*/api/admin/tracks/:id/retry', ({ request, params }) => {
    if (!isAdmin(request)) return deny();
    const t = cat.tracks.find((x) => x.id === params.id);
    if (!t) return notFound();
    cat.calls.retry.push(t.id);
    Object.assign(t, { status: 'PENDING', errorMessage: null });
    return HttpResponse.json(publicTrack(t));
  }),
  http.patch('*/api/admin/tracks/:id', async ({ request, params }) => {
    if (!isAdmin(request)) return deny();
    const t = cat.tracks.find((x) => x.id === params.id);
    if (!t) return notFound();
    Object.assign(t, (await request.json()) as Partial<AdminTrack>);
    return HttpResponse.json(publicTrack(t));
  }),
  http.delete('*/api/admin/albums/:id', ({ request, params }) => {
    if (!isAdmin(request)) return deny();
    const withTracks = new URL(request.url).searchParams.get('deleteTracks') === 'true';
    const count = cat.tracks.filter((t) => t.albumId === params.id).length;
    if (count && !withTracks) return HttpResponse.json({ message: `This album has ${count} tracks.` }, { status: 409 });
    cat.calls.deleted.push(String(params.id));
    cat.tracks = cat.tracks.filter((t) => t.albumId !== params.id);
    cat.albums = cat.albums.filter((a) => a.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),
  http.delete('*/api/admin/tracks/:id', ({ request, params }) => {
    if (!isAdmin(request)) return deny();
    cat.calls.deleted.push(String(params.id));
    cat.tracks = cat.tracks.filter((x) => x.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),
];
