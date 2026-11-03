import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  albumIsVisible,
  artistRef,
  presentAlbum,
  presentArtist,
  presentTrackWithAlbum,
  trackWithAlbum,
} from '../catalog/presenters';

export const SEARCH_LIMITS = { tracks: 20, albums: 12, artists: 12 } as const;

/** Escape LIKE wildcards so "100%" searches for a literal percent sign. */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Keep the order of `ids` when Prisma returns rows in any order. */
function inOrder<T extends { id: string }>(ids: string[], rows: T[]): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id)).filter((r): r is T => r !== undefined);
}

/**
 * Search over playable music using pg_trgm (GIN trigram indexes).
 * Matches substrings (ILIKE) and near-misses such as typos (word similarity, the <% operator).
 * Ranking: exact title, then title prefix, then similarity; artist-name matches count a bit less
 * than title matches, so "nina" finds Nina Simone's songs after songs titled "Nina".
 */
@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(rawQuery: string) {
    const q = rawQuery.trim();
    const contains = `%${escapeLike(q)}%`;
    const prefix = `${escapeLike(q)}%`;

    const [trackIds, albumIds, artistIds] = await Promise.all([
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT t.id FROM "Track" t JOIN "Artist" ar ON ar.id = t."artistId"
        WHERE t.status = 'READY'
          AND (t.title ILIKE ${contains} OR ${q} <% t.title OR ar.name ILIKE ${contains} OR ${q} <% ar.name)
        ORDER BY lower(t.title) = lower(${q}) DESC,
                 t.title ILIKE ${prefix} DESC,
                 GREATEST(word_similarity(${q}, t.title), 0.8 * word_similarity(${q}, ar.name)) DESC,
                 t.title, t.id
        LIMIT ${SEARCH_LIMITS.tracks}`,
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT al.id FROM "Album" al JOIN "Artist" ar ON ar.id = al."artistId"
        WHERE EXISTS (SELECT 1 FROM "Track" t WHERE t."albumId" = al.id AND t.status = 'READY')
          AND (al.title ILIKE ${contains} OR ${q} <% al.title OR ar.name ILIKE ${contains} OR ${q} <% ar.name)
        ORDER BY lower(al.title) = lower(${q}) DESC,
                 al.title ILIKE ${prefix} DESC,
                 GREATEST(word_similarity(${q}, al.title), 0.8 * word_similarity(${q}, ar.name)) DESC,
                 al.title, al.id
        LIMIT ${SEARCH_LIMITS.albums}`,
      this.prisma.$queryRaw<{ id: string }[]>`
        SELECT ar.id FROM "Artist" ar
        WHERE EXISTS (SELECT 1 FROM "Track" t WHERE t."artistId" = ar.id AND t.status = 'READY')
          AND (ar.name ILIKE ${contains} OR ${q} <% ar.name)
        ORDER BY lower(ar.name) = lower(${q}) DESC,
                 ar.name ILIKE ${prefix} DESC,
                 word_similarity(${q}, ar.name) DESC,
                 ar.name, ar.id
        LIMIT ${SEARCH_LIMITS.artists}`,
    ]);

    const [tracks, albums, artists] = await Promise.all([
      this.prisma.track.findMany({ where: { id: { in: trackIds.map((r) => r.id) } }, include: trackWithAlbum }),
      this.prisma.album.findMany({
        where: { id: { in: albumIds.map((r) => r.id) }, ...albumIsVisible },
        include: { artist: artistRef },
      }),
      this.prisma.artist.findMany({ where: { id: { in: artistIds.map((r) => r.id) } } }),
    ]);

    return {
      tracks: inOrder(trackIds.map((r) => r.id), tracks).map(presentTrackWithAlbum),
      albums: inOrder(albumIds.map((r) => r.id), albums).map(presentAlbum),
      artists: inOrder(artistIds.map((r) => r.id), artists).map(presentArtist),
    };
  }
}
