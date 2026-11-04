import { Module } from '@nestjs/common';
import { AdminAlbumsController, AdminArtistsController, AdminGenresController } from './admin-catalog.controller';
import { AlbumsService } from './albums.service';
import { ArtistsService } from './artists.service';
import { CatalogController } from './catalog.controller';
import { GenresService } from './genres.service';
import { ListeningService } from './listening.service';

@Module({
  controllers: [CatalogController, AdminArtistsController, AdminAlbumsController, AdminGenresController],
  providers: [ArtistsService, AlbumsService, GenresService, ListeningService],
  exports: [ArtistsService, AlbumsService],
})
export class CatalogModule {}
