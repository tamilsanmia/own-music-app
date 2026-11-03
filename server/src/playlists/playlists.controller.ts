import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { PlaylistsService } from './playlists.service';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

class CreatePlaylistDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @trim()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;
}

class UpdatePlaylistDto {
  @trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  /** null clears it. */
  @trim()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string | null;
}

class AddTracksDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  trackIds: string[];
}

class MoveDto {
  @IsUUID()
  itemId: string;

  @IsInt()
  @Min(0)
  toIndex: number;
}

const uuid = new ParseUUIDPipe();

@Controller('me/playlists')
export class PlaylistsController {
  constructor(private readonly playlists: PlaylistsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.playlists.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreatePlaylistDto) {
    return this.playlists.create(user.id, dto.name, dto.description);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.playlists.get(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: UpdatePlaylistDto) {
    return this.playlists.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string) {
    return this.playlists.delete(user.id, id);
  }

  @Post(':id/tracks')
  add(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: AddTracksDto) {
    return this.playlists.addTracks(user.id, id, dto.trackIds);
  }

  @Delete(':id/tracks/:itemId')
  remove(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Param('itemId', uuid) itemId: string) {
    return this.playlists.removeItem(user.id, id, itemId);
  }

  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  move(@CurrentUser() user: AuthUser, @Param('id', uuid) id: string, @Body() dto: MoveDto) {
    return this.playlists.move(user.id, id, dto.itemId, dto.toIndex);
  }
}
