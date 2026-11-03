import { Prisma, TrackStatus } from '@prisma/client';
import { coverUrls } from '../media/media.service';

/** Shapes returned by the catalog API. Image URLs are paths relative to the site origin. */

export const READY = { status: TrackStatus.READY } as const;
/** Albums and artists are visible to listeners only once they have something playable. */
export const albumIsVisible: Prisma.AlbumWhereInput = { tracks: { some: READY } };
export const artistIsVisible: Prisma.ArtistWhereInput = { tracks: { some: READY } };

export const artistRef = { select: { id: true, name: true } } as const;

type ArtistRow = { id: string; name: string; bio: string | null; imageId: string | null };
type AlbumRow = {
  id: string;
  title: string;
  releaseYear: number | null;
  coverId: string | null;
  createdAt: Date;
  artist: { id: string; name: string };
};
type TrackRow = {
  id: string;
  title: string;
  trackNumber: number;
  durationMs: number | null;
  artist: { id: string; name: string };
};

export function presentArtist(a: ArtistRow) {
  return { id: a.id, name: a.name, bio: a.bio, image: coverUrls(a.imageId) };
}

export function presentAlbum(a: AlbumRow) {
  return {
    id: a.id,
    title: a.title,
    releaseYear: a.releaseYear,
    artist: a.artist,
    cover: coverUrls(a.coverId),
    createdAt: a.createdAt,
  };
}

export function presentTrack(t: TrackRow) {
  return {
    id: t.id,
    title: t.title,
    trackNumber: t.trackNumber,
    durationMs: t.durationMs,
    artist: t.artist,
  };
}
