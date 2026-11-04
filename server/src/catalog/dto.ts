import { applyDecorators } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export const MAX_GENRES = 5;
export const MAX_GENRE_LENGTH = 40;

/** Up to 5 genres or moods per album, each 1-40 characters, trimmed. */
const genres = () =>
  applyDecorators(
    Transform(({ value }) =>
      Array.isArray(value) ? value.map((g) => (typeof g === 'string' ? g.trim().replace(/\s+/g, ' ') : g)) : value,
    ),
    IsOptional(),
    IsArray(),
    ArrayMaxSize(MAX_GENRES),
    IsString({ each: true }),
    IsNotEmpty({ each: true }),
    MaxLength(MAX_GENRE_LENGTH, { each: true }),
  );

export class CreateArtistDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @trim()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  bio?: string;
}

export class UpdateArtistDto {
  @trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  /** null clears the bio. */
  @trim()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  bio?: string | null;
}

export class CreateAlbumDto {
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsUUID()
  artistId: string;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(2100)
  releaseYear?: number;

  @genres()
  genres?: string[];
}

export class UpdateAlbumDto {
  @trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsUUID()
  artistId?: string;

  /** null clears the year. */
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsInt()
  @Min(1000)
  @Max(2100)
  releaseYear?: number | null;

  /** Replaces the list; [] removes all genres. */
  @genres()
  genres?: string[];
}

export class PageQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset = 0;
}

export class AdminAlbumsQuery extends PageQuery {
  @IsOptional()
  @IsUUID()
  artistId?: string;
}

export class DeleteAlbumQuery {
  /** Also delete the album's tracks and their files. */
  @IsOptional()
  @IsIn(['true', 'false'])
  deleteTracks?: 'true' | 'false';
}
