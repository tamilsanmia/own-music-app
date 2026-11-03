import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TrackStatus } from '@prisma/client';
import { presentTrackWithAlbum, trackWithAlbum } from '../catalog/presenters';
import { coverUrls } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';

export const MAX_PLAYLISTS = 500;
export const MAX_PLAYLIST_ITEMS = 5000;
const READY = { status: TrackStatus.READY } as const;

/** Up to 4 distinct album covers from the first tracks, for a 2x2 mosaic. */
function mosaic(covers: (string | null)[]) {
  return [...new Set(covers.filter((c): c is string => !!c))].slice(0, 4).map((id) => coverUrls(id)!);
}

/**
 * Playlists belong to one user. Every query filters on ownerId, so another user's playlist
 * looks exactly like a missing one (404). Positions are 0-based and contiguous.
 */
@Injectable()
export class PlaylistsService {
  constructor(private readonly prisma: PrismaService) {}

  private async owned(userId: string, id: string) {
    const p = await this.prisma.playlist.findFirst({ where: { id, ownerId: userId } });
    if (!p) throw new NotFoundException('Playlist not found');
    return p;
  }

  async list(userId: string) {
    const rows = await this.prisma.playlist.findMany({
      where: { ownerId: userId },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      include: {
        _count: { select: { items: { where: { track: READY } } } },
        items: {
          where: { track: READY },
          orderBy: { position: 'asc' },
          take: 12,
          select: { track: { select: { album: { select: { coverId: true } } } } },
        },
      },
    });
    return rows.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      trackCount: p._count.items,
      covers: mosaic(p.items.map((i) => i.track.album.coverId)),
      updatedAt: p.updatedAt,
    }));
  }

  async get(userId: string, id: string) {
    const p = await this.prisma.playlist.findFirst({
      where: { id, ownerId: userId },
      include: {
        items: {
          where: { track: READY },
          orderBy: { position: 'asc' },
          include: { track: { include: trackWithAlbum } },
        },
      },
    });
    if (!p) throw new NotFoundException('Playlist not found');
    const items = p.items.map((i) => ({ itemId: i.id, addedAt: i.addedAt, track: presentTrackWithAlbum(i.track) }));
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      trackCount: items.length,
      covers: mosaic(p.items.map((i) => i.track.album.coverId)),
      items,
    };
  }

  async create(userId: string, name: string, description?: string) {
    if ((await this.prisma.playlist.count({ where: { ownerId: userId } })) >= MAX_PLAYLISTS) {
      throw new BadRequestException(`You can have at most ${MAX_PLAYLISTS} playlists`);
    }
    const p = await this.prisma.playlist.create({ data: { ownerId: userId, name, description: description || null } });
    return this.get(userId, p.id);
  }

  async update(userId: string, id: string, input: { name?: string; description?: string | null }) {
    await this.owned(userId, id);
    await this.prisma.playlist.update({
      where: { id },
      data: { name: input.name, description: input.description === undefined ? undefined : input.description || null },
    });
    return this.get(userId, id);
  }

  async delete(userId: string, id: string): Promise<void> {
    await this.owned(userId, id);
    await this.prisma.playlist.delete({ where: { id } });
  }

  /** Append tracks in the given order. Tracks that aren't playable are skipped. */
  async addTracks(userId: string, id: string, trackIds: string[]) {
    await this.owned(userId, id);
    const playable = new Set(
      (await this.prisma.track.findMany({ where: { id: { in: trackIds }, ...READY }, select: { id: true } })).map((t) => t.id),
    );
    const toAdd = trackIds.filter((t) => playable.has(t));
    if (toAdd.length === 0) throw new NotFoundException('None of these tracks can be added');

    await this.prisma.$transaction(async (tx) => {
      // Lock the playlist row so concurrent appends get distinct positions.
      await tx.$queryRaw`SELECT id FROM "Playlist" WHERE id = ${id}::uuid FOR UPDATE`;
      const count = await tx.playlistTrack.count({ where: { playlistId: id } });
      if (count + toAdd.length > MAX_PLAYLIST_ITEMS) {
        throw new BadRequestException(`A playlist can hold at most ${MAX_PLAYLIST_ITEMS} songs`);
      }
      await tx.playlistTrack.createMany({
        data: toAdd.map((trackId, i) => ({ playlistId: id, trackId, position: count + i })),
      });
      await tx.playlist.update({ where: { id }, data: { updatedAt: new Date() } });
    });
    return { added: toAdd.length, skipped: trackIds.length - toAdd.length };
  }

  async removeItem(userId: string, id: string, itemId: string) {
    await this.owned(userId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Playlist" WHERE id = ${id}::uuid FOR UPDATE`;
      const item = await tx.playlistTrack.findFirst({ where: { id: itemId, playlistId: id } });
      if (!item) throw new NotFoundException('Song not in this playlist');
      await tx.playlistTrack.delete({ where: { id: itemId } });
      await tx.playlistTrack.updateMany({
        where: { playlistId: id, position: { gt: item.position } },
        data: { position: { decrement: 1 } },
      });
      await tx.playlist.update({ where: { id }, data: { updatedAt: new Date() } });
    });
    return this.get(userId, id);
  }

  /** Move one entry to `toIndex` (0-based, among all entries). */
  async move(userId: string, id: string, itemId: string, toIndex: number) {
    await this.owned(userId, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Playlist" WHERE id = ${id}::uuid FOR UPDATE`;
      const items = await tx.playlistTrack.findMany({
        where: { playlistId: id },
        orderBy: [{ position: 'asc' }, { addedAt: 'asc' }],
        select: { id: true, position: true },
      });
      const from = items.findIndex((i) => i.id === itemId);
      if (from < 0) throw new NotFoundException('Song not in this playlist');
      const to = Math.max(0, Math.min(toIndex, items.length - 1));
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      // Rewrite only the positions that changed.
      const updates: Prisma.PrismaPromise<unknown>[] = [];
      items.forEach((item, position) => {
        if (item.position !== position) updates.push(tx.playlistTrack.update({ where: { id: item.id }, data: { position } }));
      });
      await Promise.all(updates);
      await tx.playlist.update({ where: { id }, data: { updatedAt: new Date() } });
    });
    return this.get(userId, id);
  }
}
