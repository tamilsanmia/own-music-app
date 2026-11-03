import { Module } from '@nestjs/common';
import { AdminAlbumsController, AdminArtistsController } from './admin-catalog.controller';
import { AlbumsService } from './albums.service';
import { ArtistsService } from './artists.service';
import { CatalogController } from './catalog.controller';

@Module({
  controllers: [CatalogController, AdminArtistsController, AdminAlbumsController],
  providers: [ArtistsService, AlbumsService],
  exports: [ArtistsService, AlbumsService],
})
export class CatalogModule {}
