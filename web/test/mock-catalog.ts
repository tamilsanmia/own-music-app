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
  },
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
  cat.calls = { chunks: [], getAlbum: 0, retry: [], deleted: [] };
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

export const catalogHandlers = [
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
  http.delete('*/api/admin/tracks/:id', ({ request, params }) => {
    if (!isAdmin(request)) return deny();
    cat.calls.deleted.push(String(params.id));
    cat.tracks = cat.tracks.filter((x) => x.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),
];
