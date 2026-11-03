import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { TrackStatus } from '@prisma/client';
import { presentTrackWithAlbum, trackWithAlbum } from '../catalog/presenters';
import { PrismaService } from '../prisma/prisma.service';

/** Two reports of the same track this close together count as one play (client retries). */
export const PLAY_DEDUPE_MS = 30_000;
/** Offline plays (Android) may be reported this late. */
export const MAX_PLAY_AGE_MS = 30 * 24 * 3600_000;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
export const RECENT_LIMIT = 20;

/** A listener's own library: liked songs and play history. */
@Injectable()
export class LibraryService {
  constructor(private readonly prisma: PrismaService) {}

  private async mustBePlayable(trackId: string): Promise<void> {
    const n = await this.prisma.track.count({ where: { id: trackId, status: TrackStatus.READY } });
    if (!n) throw new NotFoundException('Track not found');
  }

  // ---- likes ----

  /** Every liked track id, so clients can show hearts anywhere without extra requests. */
  async likedIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.likedTrack.findMany({
      where: { userId },
      select: { trackId: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => r.trackId);
  }

  async likes(userId: string, limit: number, offset: number) {
    const where = { userId, track: { status: TrackStatus.READY } };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.likedTrack.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { trackId: 'asc' }],
        take: limit,
        skip: offset,
        include: { track: { include: trackWithAlbum } },
      }),
      this.prisma.likedTrack.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({ ...presentTrackWithAlbum(r.track), likedAt: r.createdAt })),
      total,
    };
  }

  /** Idempotent: liking twice is fine. */
  async like(userId: string, trackId: string): Promise<void> {
    await this.mustBePlayable(trackId);
    await this.prisma.likedTrack.createMany({ data: [{ userId, trackId }], skipDuplicates: true });
  }

  /** Idempotent: unliking something not liked is fine. */
  async unlike(userId: string, trackId: string): Promise<void> {
    await this.prisma.likedTrack.deleteMany({ where: { userId, trackId } });
  }

  // ---- history ----

  async recordPlay(userId: string, trackId: string, playedAtIso?: string): Promise<void> {
    const now = Date.now();
    const playedAt = playedAtIso ? new Date(playedAtIso) : new Date(now);
    if (playedAt.getTime() > now + MAX_CLOCK_SKEW_MS) throw new BadRequestException('playedAt is in the future');
    if (playedAt.getTime() < now - MAX_PLAY_AGE_MS) throw new BadRequestException('playedAt is more than 30 days ago');
    await this.mustBePlayable(trackId);

    const near = await this.prisma.playHistory.count({
      where: {
        userId,
        trackId,
        playedAt: { gte: new Date(playedAt.getTime() - PLAY_DEDUPE_MS), lte: new Date(playedAt.getTime() + PLAY_DEDUPE_MS) },
      },
    });
    if (near) return;
    await this.prisma.playHistory.create({ data: { userId, trackId, playedAt } });
  }

  /** Recently played tracks, newest first, each track once. */
  async recent(userId: string, limit = RECENT_LIMIT) {
    const groups = await this.prisma.playHistory.groupBy({
      by: ['trackId'],
      where: { userId, track: { status: TrackStatus.READY } },
      _max: { playedAt: true },
      orderBy: { _max: { playedAt: 'desc' } },
      take: limit,
    });
    const tracks = await this.prisma.track.findMany({
      where: { id: { in: groups.map((g) => g.trackId) } },
      include: trackWithAlbum,
    });
    const byId = new Map(tracks.map((t) => [t.id, t]));
    return {
      items: groups
        .filter((g) => byId.has(g.trackId))
        .map((g) => ({ ...presentTrackWithAlbum(byId.get(g.trackId)!), playedAt: g._max.playedAt })),
    };
  }
}
