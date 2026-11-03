import { Module } from '@nestjs/common';
import { LibraryController, SearchController } from './discover.controller';
import { LibraryService } from './library.service';
import { SearchService } from './search.service';

@Module({
  controllers: [SearchController, LibraryController],
  providers: [SearchService, LibraryService],
})
export class DiscoverModule {}
