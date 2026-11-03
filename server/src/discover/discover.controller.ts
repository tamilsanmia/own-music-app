import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsISO8601, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { PageQuery } from '../catalog/dto';
import { LibraryService } from './library.service';
import { SearchService } from './search.service';

class SearchQuery {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  q: string;
}

class RecordPlayDto {
  @IsUUID()
  trackId: string;

  /** When the play happened; defaults to now. Lets offline plays be reported later. */
  @IsOptional()
  @IsISO8601({ strict: true })
  playedAt?: string;
}

const uuid = new ParseUUIDPipe();

@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@Query() query: SearchQuery) {
    return this.searchService.search(query.q);
  }
}

@Controller('me')
export class LibraryController {
  constructor(private readonly library: LibraryService) {}

  @Get('likes')
  likes(@CurrentUser() user: AuthUser, @Query() page: PageQuery) {
    return this.library.likes(user.id, page.limit, page.offset);
  }

  @Get('likes/ids')
  likedIds(@CurrentUser() user: AuthUser) {
    return this.library.likedIds(user.id);
  }

  @Put('likes/:trackId')
  @HttpCode(HttpStatus.NO_CONTENT)
  like(@CurrentUser() user: AuthUser, @Param('trackId', uuid) trackId: string) {
    return this.library.like(user.id, trackId);
  }

  @Delete('likes/:trackId')
  @HttpCode(HttpStatus.NO_CONTENT)
  unlike(@CurrentUser() user: AuthUser, @Param('trackId', uuid) trackId: string) {
    return this.library.unlike(user.id, trackId);
  }

  @Post('history')
  @HttpCode(HttpStatus.NO_CONTENT)
  recordPlay(@CurrentUser() user: AuthUser, @Body() dto: RecordPlayDto) {
    return this.library.recordPlay(user.id, dto.trackId, dto.playedAt);
  }

  @Get('recent')
  recent(@CurrentUser() user: AuthUser) {
    return this.library.recent(user.id);
  }
}
