import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TrackStatus } from '@prisma/client';
import { coverUrls } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { albumIsVisible, artistRef, presentAlbum } from './presenters';

export interface GenreSummary {
  name: string;
  albumCount: number;
  /** Cover of the newest album in the genre, for the browse tile. */
  cover: { small: string; large: string } | null;
}

/** Genres (or moods) are free-text tags on albums. Tracks take their album's genres. */
@Injectable()
export class GenresService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Trim, drop duplicates (ignoring case), and reuse the spelling already in the catalog, so
   * "melody" typed later joins the existing "Melody".
   */
  async canonical(input: string[]): Promise<string[]> {
    const existing = await this.allNames();
    const byKey = new Map(existing.map((g) => [g.toLowerCase(), g]));
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of input) {
      const g = raw.trim().replace(/\s+/g, ' ');
      const key = g.toLowerCase();
      if (!g || seen.has(key)) continue;
      seen.add(key);
      out.push(byKey.get(key) ?? g);
    }
    return out;
  }

  /** Every genre used by any album, including albums listeners can't see yet (for the admin). */
  async allNames(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ name: string }[]>`
      SELECT DISTINCT g AS name FROM "Album" a, unnest(a.genres) AS g ORDER BY 1`;
    return rows.map((r) => r.name);
  }

  /** Genres that have at least one playable album, most albums first. */
  async list(): Promise<GenreSummary[]> {
    const rows = await this.prisma.$queryRaw<{ name: string; albumCount: bigint; coverId: string | null }[]>`
      SELECT g AS name,
             count(*) AS "albumCount",
             (array_agg(a."coverId" ORDER BY a."createdAt" DESC) FILTER (WHERE a."coverId" IS NOT NULL))[1] AS "coverId"
      FROM "Album" a, unnest(a.genres) AS g
      WHERE EXISTS (SELECT 1 FROM "Track" t WHERE t."albumId" = a.id AND t.status = ${TrackStatus.READY}::"TrackStatus")
      GROUP BY g
      ORDER BY count(*) DESC, g ASC`;
    return rows.map((r) => ({ name: r.name, albumCount: Number(r.albumCount), cover: coverUrls(r.coverId) }));
  }

  /** Playable albums in one genre (case-insensitive), newest first. */
  async albums(name: string) {
    const match = (await this.allNames()).find((g) => g.toLowerCase() === name.trim().toLowerCase());
    if (!match) throw new NotFoundException('Genre not found');
    const where: Prisma.AlbumWhereInput = { ...albumIsVisible, genres: { has: match } };
    const albums = await this.prisma.album.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 100,
      include: { artist: artistRef },
    });
    if (albums.length === 0) throw new NotFoundException('Genre not found');
    return { name: match, albums: albums.map(presentAlbum) };
  }
}
