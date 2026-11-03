import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { AlbumsService } from './albums.service';
import { ArtistsService } from './artists.service';
import { PageQuery } from './dto';

const uuid = new ParseUUIDPipe();

/** Read-only catalog for any logged-in user. Only shows music that can be played. */
@Controller()
export class CatalogController {
  constructor(
    private readonly artists: ArtistsService,
    private readonly albums: AlbumsService,
  ) {}

  @Get('home')
  home() {
    return this.albums.home();
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
}
