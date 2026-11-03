import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/decorators';
import { CreateTrackDto, UpdateTrackDto } from './dto';
import { TracksService } from './tracks.service';

const uuid = new ParseUUIDPipe();

/**
 * Chunked upload, so large files never hit the proxy's per-request timeout:
 *   POST   /api/admin/tracks                       { albumId, filename, sizeBytes, title?, trackNumber? }
 *   PUT    /api/admin/tracks/:id/upload?offset=N   raw bytes, Content-Type: application/octet-stream
 *   GET    /api/admin/tracks/:id/upload            { receivedBytes } to resume after an error
 *   POST   /api/admin/tracks/:id/upload/complete   checks the audio and queues transcoding
 */
@Roles(Role.ADMIN)
@Controller('admin/tracks')
export class AdminTracksController {
  constructor(private readonly tracks: TracksService) {}

  @Post()
  create(@Body() dto: CreateTrackDto) {
    return this.tracks.create(dto);
  }

  @Get(':id')
  get(@Param('id', uuid) id: string) {
    return this.tracks.get(id);
  }

  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateTrackDto) {
    return this.tracks.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', uuid) id: string) {
    return this.tracks.delete(id);
  }

  @Get(':id/upload')
  uploadStatus(@Param('id', uuid) id: string) {
    return this.tracks.uploadStatus(id);
  }

  @Put(':id/upload')
  uploadChunk(
    @Param('id', uuid) id: string,
    @Query('offset', new ParseIntPipe()) offset: number,
    @Req() req: Request,
  ) {
    if (!req.is('application/octet-stream')) {
      req.resume();
      throw new UnsupportedMediaTypeException('Send chunks as application/octet-stream');
    }
    const length = req.headers['content-length'];
    return this.tracks.appendChunk(id, offset, req, length === undefined ? undefined : Number(length));
  }

  @Post(':id/upload/complete')
  @HttpCode(HttpStatus.OK)
  complete(@Param('id', uuid) id: string) {
    return this.tracks.complete(id);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  retry(@Param('id', uuid) id: string) {
    return this.tracks.retry(id);
  }
}
