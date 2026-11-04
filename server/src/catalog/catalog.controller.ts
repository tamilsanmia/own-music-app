import { Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { TrackStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { isSyncedLyrics } from '../tracks/lyrics';
import { AlbumsService } from './albums.service';
import { ArtistsService } from './artists.service';
import { PageQuery } from './dto';
import { GenresService } from './genres.service';
import { ListeningService } from './listening.service';

const uuid = new ParseUUIDPipe();

class RadioDto {
  @IsUUID()
  seedTrackId: string;

  /** The current queue, oldest first; these songs are skipped. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  excludeTrackIds?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

/** Read-only catalog for any logged-in user. Only shows music that can be played. */
@Controller()
export class CatalogController {
  constructor(
    private readonly artists: ArtistsService,
    private readonly albums: AlbumsService,
    private readonly genres: GenresService,
    private readonly listening: ListeningService,
    private readonly prisma: PrismaService,
  ) {}

  /** New albums, plus the listener's top songs, this week's top songs and the genres. */
  @Get('home')
  async home(@CurrentUser() user: AuthUser) {
    const [base, mostPlayed, topThisWeek, genres] = await Promise.all([
      this.albums.home(),
      this.listening.mostPlayed(user.id),
      this.listening.topThisWeek(),
      this.genres.list(),
    ]);
    return { ...base, mostPlayed, topThisWeek, genres };
  }

  @Get('artists')
  listArtists(@Query() q: PageQuery) {
    return this.artists.listVisible(q);
  }

  @Get('artists/:id')
  getArtist(@Param('id', uuid) id: string) {
    return this.artists.getVisible(id);
  }

  @Get('albums/:id')
  getAlbum(@Param('id', uuid) id: string) {
    return this.albums.getVisible(id);
  }

  @Get('genres')
  listGenres() {
    return this.genres.list();
  }

  @Get('genres/:name')
  getGenre(@Param('name') name: string) {
    return this.genres.albums(name);
  }

  /** `synced` is true when the lyrics carry LRC time tags. `lyrics` is null if there are none. */
  @Get('tracks/:id/lyrics')
  async lyrics(@Param('id', uuid) id: string) {
    const track = await this.prisma.track.findFirst({
      where: { id, status: TrackStatus.READY },
      select: { lyrics: true },
    });
    if (!track) throw new NotFoundException('Track not found');
    return { lyrics: track.lyrics, synced: track.lyrics ? isSyncedLyrics(track.lyrics) : false };
  }

  /** More songs like the seed, for "Start radio" and autoplay when the queue ends. */
  @Post('radio')
  @HttpCode(HttpStatus.OK)
  async radio(@CurrentUser() user: AuthUser, @Body() dto: RadioDto) {
    const items = await this.listening.radio(user.id, dto.seedTrackId, dto.excludeTrackIds ?? [], dto.limit ?? 20);
    return { items };
  }
}
