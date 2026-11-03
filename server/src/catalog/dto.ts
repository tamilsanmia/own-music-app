import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

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
