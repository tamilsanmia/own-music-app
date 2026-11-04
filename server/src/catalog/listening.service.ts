import { Injectable, NotFoundException } from '@nestjs/common';
import { TrackStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { presentTrackWithAlbum, trackWithAlbum } from './presenters';

/** Home sections. */
export const HOME_TRACK_LIMIT = 10;
const MOST_PLAYED_DAYS = 90;
/** A song needs this many plays to count as one of "your top songs". */
const MOST_PLAYED_MIN_PLAYS = 2;
const TOP_DAYS = 7;

/** Radio: how many tracks to consider, and how many may come from one album. */
const RADIO_POOL = 5000;
const RADIO_PER_ALBUM = 3;
/** Queue entries this recent are never repeated, even when the catalog runs out. */
const RADIO_NO_REPEAT = 15;

const DAY_MS = 24 * 3600_000;

/** Play-count based lists and "radio" (more songs like this one). */
@Injectable()
export class ListeningService {
  constructor(private readonly prisma: PrismaService) {}

  /** The listener's most played songs in the last 90 days. */
  async mostPlayed(userId: string, limit = HOME_TRACK_LIMIT) {
    const groups = await this.prisma.playHistory.groupBy({
      by: ['trackId'],
      where: { userId, playedAt: { gte: new Date(Date.now() - MOST_PLAYED_DAYS * DAY_MS) }, track: { status: TrackStatus.READY } },
      _count: { trackId: true },
      orderBy: [{ _count: { trackId: 'desc' } }, { trackId: 'asc' }],
      having: { trackId: { _count: { gte: MOST_PLAYED_MIN_PLAYS } } },
      take: limit,
    });
    return this.hydrate(groups.map((g) => g.trackId));
  }

  /** Most played songs across all listeners in the last 7 days. */
  async topThisWeek(limit = HOME_TRACK_LIMIT) {
    const groups = await this.prisma.playHistory.groupBy({
      by: ['trackId'],
      where: { playedAt: { gte: new Date(Date.now() - TOP_DAYS * DAY_MS) }, track: { status: TrackStatus.READY } },
      _count: { trackId: true },
      orderBy: [{ _count: { trackId: 'desc' } }, { trackId: 'asc' }],
      take: limit,
    });
    return this.hydrate(groups.map((g) => g.trackId));
  }

  /**
   * Songs to play after `seedTrackId`. Same artist and shared genres rank highest, then the
   * same album and the listener's liked songs, with some randomness so every radio differs.
   * `exclude` is the current queue in order; once the catalog runs out, older entries may
   * come back, but never the last 15.
   */
  async radio(userId: string, seedTrackId: string, exclude: string[], limit: number) {
    const seed = await this.prisma.track.findFirst({
      where: { id: seedTrackId, status: TrackStatus.READY },
      select: { id: true, artistId: true, albumId: true, album: { select: { genres: true } } },
    });
    if (!seed) throw new NotFoundException('Track not found');

    const [pool, liked] = await Promise.all([
      this.prisma.track.findMany({
        where: { status: TrackStatus.READY, id: { not: seed.id } },
        select: { id: true, artistId: true, albumId: true, album: { select: { genres: true } } },
        take: RADIO_POOL,
      }),
      this.prisma.likedTrack.findMany({ where: { userId }, select: { trackId: true } }),
    ]);
    const likedIds = new Set(liked.map((l) => l.trackId));
    const seedGenres = new Set(seed.album.genres.map((g) => g.toLowerCase()));
    const score = (t: (typeof pool)[number]) =>
      (t.artistId === seed.artistId ? 3 : 0) +
      2 * t.album.genres.filter((g) => seedGenres.has(g.toLowerCase())).length +
      (t.albumId === seed.albumId ? 1 : 0) +
      (likedIds.has(t.id) ? 1 : 0) +
      Math.random() * 2.5;
    const ranked = pool.map((t) => ({ t, s: score(t) })).sort((a, b) => b.s - a.s).map((x) => x.t);

    const excluded = new Set(exclude);
    const recent = new Set(exclude.slice(-RADIO_NO_REPEAT));
    const picked: string[] = [];
    const perAlbum = new Map<string, number>();
    const take = (allow: (id: string) => boolean, capPerAlbum: boolean) => {
      for (const t of ranked) {
        if (picked.length >= limit) return;
        if (!allow(t.id) || picked.includes(t.id)) continue;
        const n = perAlbum.get(t.albumId) ?? 0;
        if (capPerAlbum && n >= RADIO_PER_ALBUM) continue;
        perAlbum.set(t.albumId, n + 1);
        picked.push(t.id);
      }
    };
    // Variety first; then anything new; small catalogs may then repeat older songs.
    take((id) => !excluded.has(id), true);
    take((id) => !excluded.has(id), false);
    take((id) => !recent.has(id), false);
    return this.hydrate(picked);
  }

  /** Full track rows in the given order. */
  private async hydrate(ids: string[]) {
    if (ids.length === 0) return [];
    const tracks = await this.prisma.track.findMany({ where: { id: { in: ids } }, include: trackWithAlbum });
    const byId = new Map(tracks.map((t) => [t.id, t]));
    return ids.flatMap((id) => (byId.has(id) ? [presentTrackWithAlbum(byId.get(id)!)] : []));
  }
}
