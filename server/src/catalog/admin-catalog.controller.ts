import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/decorators';
import { AlbumsService } from './albums.service';
import { ArtistsService } from './artists.service';
import { AdminAlbumsQuery, CreateAlbumDto, CreateArtistDto, PageQuery, UpdateAlbumDto, UpdateArtistDto } from './dto';
import { ImageUpload, requireFile } from './image-upload';

const uuid = new ParseUUIDPipe();

@Roles(Role.ADMIN)
@Controller('admin/artists')
export class AdminArtistsController {
  constructor(private readonly artists: ArtistsService) {}

  @Get()
  list(@Query() q: PageQuery) {
    return this.artists.adminList(q);
  }

  @Post()
  create(@Body() dto: CreateArtistDto) {
    return this.artists.create(dto);
  }

  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateArtistDto) {
    return this.artists.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', uuid) id: string) {
    return this.artists.delete(id);
  }

  @Put(':id/image')
  @ImageUpload()
  setImage(@Param('id', uuid) id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.artists.setImage(id, requireFile(file));
  }

  @Delete(':id/image')
  removeImage(@Param('id', uuid) id: string) {
    return this.artists.removeImage(id);
  }
}

@Roles(Role.ADMIN)
@Controller('admin/albums')
export class AdminAlbumsController {
  constructor(private readonly albums: AlbumsService) {}

  @Get()
  list(@Query() q: AdminAlbumsQuery) {
    return this.albums.adminList(q);
  }

  @Get(':id')
  get(@Param('id', uuid) id: string) {
    return this.albums.adminGet(id);
  }

  @Post()
  create(@Body() dto: CreateAlbumDto) {
    return this.albums.create(dto);
  }

  @Patch(':id')
  update(@Param('id', uuid) id: string, @Body() dto: UpdateAlbumDto) {
    return this.albums.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id', uuid) id: string) {
    return this.albums.delete(id);
  }

  @Put(':id/cover')
  @ImageUpload()
  setCover(@Param('id', uuid) id: string, @UploadedFile() file?: Express.Multer.File) {
    return this.albums.setCover(id, requireFile(file));
  }

  @Delete(':id/cover')
  removeCover(@Param('id', uuid) id: string) {
    return this.albums.removeCover(id);
  }
}
