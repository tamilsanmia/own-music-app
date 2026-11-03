import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { TranscodeQueue } from '../queue/transcode-queue';
import { presentAdminTrack } from '../tracks/presenters';
import type { AdminAlbumsQuery, CreateAlbumDto, UpdateAlbumDto } from './dto';
import { albumIsVisible, artistRef, presentAlbum, presentTrack, READY } from './presenters';

/** How many albums the Home screen shows. */
export const HOME_ALBUM_LIMIT = 20;

@Injectable()
export class AlbumsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
    private readonly queue: TranscodeQueue,
  ) {}

  // ---- listener reads ----

  async getVisible(id: string) {
    const album = await this.prisma.album.findFirst({
      where: { id, ...albumIsVisible },
      include: {
        artist: artistRef,
        tracks: { where: READY, orderBy: [{ trackNumber: 'asc' }, { createdAt: 'asc' }], include: { artist: artistRef } },
      },
    });
    if (!album) throw new NotFoundException('Album not found');
    return { ...presentAlbum(album), tracks: album.tracks.map(presentTrack) };
  }

  async home() {
    const newAlbums = await this.prisma.album.findMany({
      where: albumIsVisible,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: HOME_ALBUM_LIMIT,
      include: { artist: artistRef },
    });
    return { newAlbums: newAlbums.map(presentAlbum) };
  }

  // ---- admin ----

  async adminList({ limit, offset, artistId }: AdminAlbumsQuery) {
    const where = artistId ? { artistId } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.album.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
        include: { artist: artistRef, _count: { select: { tracks: true } } },
      }),
      this.prisma.album.count({ where }),
    ]);
    return { items: items.map((a) => ({ ...presentAlbum(a), trackCount: a._count.tracks })), total };
  }

  /** Album with every track in any state, for the admin's album page. */
  async adminGet(id: string) {
    const album = await this.prisma.album.findUnique({
      where: { id },
      include: {
        artist: artistRef,
        tracks: { orderBy: [{ trackNumber: 'asc' }, { createdAt: 'asc' }], include: { artist: artistRef } },
      },
    });
    if (!album) throw new NotFoundException('Album not found');
    return { ...presentAlbum(album), tracks: album.tracks.map(presentAdminTrack) };
  }

  async create(dto: CreateAlbumDto) {
    await this.artistMustExist(dto.artistId);
    const album = await this.prisma.album.create({
      data: { title: dto.title, artistId: dto.artistId, releaseYear: dto.releaseYear ?? null },
      include: { artist: artistRef },
    });
    return presentAlbum(album);
  }

  async update(id: string, dto: UpdateAlbumDto) {
    await this.mustExist(id);
    if (dto.artistId) await this.artistMustExist(dto.artistId);
    const album = await this.prisma.album.update({
      where: { id },
      data: { title: dto.title, artistId: dto.artistId, releaseYear: dto.releaseYear },
      include: { artist: artistRef },
    });
    return presentAlbum(album);
  }

  /**
   * Delete an album. If it has tracks, `withTracks` must be set: then its tracks, their likes
   * and play history, uploaded files, streams and queued jobs go too. Database rows are removed
   * in one transaction; files are removed afterwards.
   */
  async delete(id: string, withTracks = false): Promise<{ deletedTracks: number }> {
    const album = await this.prisma.album.findUnique({
      where: { id },
      include: { tracks: { select: { id: true, originalExt: true } } },
    });
    if (!album) throw new NotFoundException('Album not found');
    const tracks = album.tracks;
    if (tracks.length > 0 && !withTracks) {
      throw new ConflictException(`This album has ${tracks.length} tracks. Delete them too with ?deleteTracks=true`);
    }

    // Drop waiting transcode jobs first; a job already running notices the track is gone.
    for (const t of tracks) await this.queue.remove(t.id);
    await this.prisma.$transaction([
      this.prisma.track.deleteMany({ where: { albumId: id } }), // likes and history cascade
      this.prisma.album.delete({ where: { id } }),
    ]);
    for (const t of tracks) await this.media.deleteTrackFiles(t.id, t.originalExt);
    await this.media.deleteCover(album.coverId);
    return { deletedTracks: tracks.length };
  }

  async setCover(id: string, file: Buffer) {
    const old = await this.mustExist(id);
    const coverId = await this.media.saveCover(file);
    try {
      const album = await this.prisma.album.update({
        where: { id },
        data: { coverId },
        include: { artist: artistRef },
      });
      await this.media.deleteCover(old.coverId);
      return presentAlbum(album);
    } catch (err) {
      await this.media.deleteCover(coverId);
      throw err;
    }
  }

  async removeCover(id: string) {
    const old = await this.mustExist(id);
    const album = await this.prisma.album.update({
      where: { id },
      data: { coverId: null },
      include: { artist: artistRef },
    });
    await this.media.deleteCover(old.coverId);
    return presentAlbum(album);
  }

  private async mustExist(id: string) {
    const album = await this.prisma.album.findUnique({ where: { id } });
    if (!album) throw new NotFoundException('Album not found');
    return album;
  }

  private async artistMustExist(artistId: string) {
    const exists = await this.prisma.artist.count({ where: { id: artistId } });
    if (!exists) throw new BadRequestException('Artist not found');
  }
}
