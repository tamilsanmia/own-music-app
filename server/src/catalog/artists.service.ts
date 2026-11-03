import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateArtistDto, PageQuery, UpdateArtistDto } from './dto';
import { albumIsVisible, artistIsVisible, artistRef, presentAlbum, presentArtist } from './presenters';

@Injectable()
export class ArtistsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  // ---- listener reads (only artists with playable music) ----

  async listVisible({ limit, offset }: PageQuery) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.artist.findMany({
        where: artistIsVisible,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
      }),
      this.prisma.artist.count({ where: artistIsVisible }),
    ]);
    return { items: items.map(presentArtist), total };
  }

  async getVisible(id: string) {
    const artist = await this.prisma.artist.findFirst({
      where: { id, ...artistIsVisible },
      include: {
        albums: {
          where: albumIsVisible,
          orderBy: [{ releaseYear: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
          include: { artist: artistRef },
        },
      },
    });
    if (!artist) throw new NotFoundException('Artist not found');
    return { ...presentArtist(artist), albums: artist.albums.map(presentAlbum) };
  }

  // ---- admin ----

  async adminList({ limit, offset }: PageQuery) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.artist.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: limit,
        skip: offset,
        include: { _count: { select: { albums: true, tracks: true } } },
      }),
      this.prisma.artist.count(),
    ]);
    return {
      items: items.map((a) => ({ ...presentArtist(a), albumCount: a._count.albums, trackCount: a._count.tracks })),
      total,
    };
  }

  async adminGet(id: string) {
    const a = await this.prisma.artist.findUnique({
      where: { id },
      include: { _count: { select: { albums: true, tracks: true } } },
    });
    if (!a) throw new NotFoundException('Artist not found');
    return { ...presentArtist(a), albumCount: a._count.albums, trackCount: a._count.tracks };
  }

  async create(dto: CreateArtistDto) {
    const artist = await this.prisma.artist.create({ data: { name: dto.name, bio: dto.bio || null } });
    return presentArtist(artist);
  }

  async update(id: string, dto: UpdateArtistDto) {
    await this.mustExist(id);
    const artist = await this.prisma.artist.update({
      where: { id },
      data: { name: dto.name, bio: dto.bio === undefined ? undefined : dto.bio || null },
    });
    return presentArtist(artist);
  }

  /** Only empty artists can be deleted, so music is never removed by accident. */
  async delete(id: string): Promise<void> {
    const artist = await this.prisma.artist.findUnique({
      where: { id },
      include: { _count: { select: { albums: true, tracks: true } } },
    });
    if (!artist) throw new NotFoundException('Artist not found');
    if (artist._count.albums > 0 || artist._count.tracks > 0) {
      throw new ConflictException('Delete or move this artist’s albums and tracks first');
    }
    await this.prisma.artist.delete({ where: { id } });
    await this.media.deleteCover(artist.imageId);
  }

  async setImage(id: string, file: Buffer) {
    const old = await this.mustExist(id);
    const imageId = await this.media.saveCover(file);
    try {
      const artist = await this.prisma.artist.update({ where: { id }, data: { imageId } });
      await this.media.deleteCover(old.imageId);
      return presentArtist(artist);
    } catch (err) {
      await this.media.deleteCover(imageId);
      throw err;
    }
  }

  async removeImage(id: string) {
    const old = await this.mustExist(id);
    const artist = await this.prisma.artist.update({ where: { id }, data: { imageId: null } });
    await this.media.deleteCover(old.imageId);
    return presentArtist(artist);
  }

  private async mustExist(id: string) {
    const artist = await this.prisma.artist.findUnique({ where: { id } });
    if (!artist) throw new NotFoundException('Artist not found');
    return artist;
  }
}
