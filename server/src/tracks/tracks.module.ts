import { Module } from '@nestjs/common';
import { AdminTracksController } from './admin-tracks.controller';
import { TracksService } from './tracks.service';

@Module({
  controllers: [AdminTracksController],
  providers: [TracksService],
  exports: [TracksService],
})
export class TracksModule {}
