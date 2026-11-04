import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { MAX_TRACK_BYTES } from './limits';

export const MAX_LYRICS_LENGTH = 20_000;

const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));

export class CreateTrackDto {
  @IsUUID()
  albumId: string;

  /** Original file name, e.g. "01 Feeling Good.flac". Used for the extension and default title. */
  @trim()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename: string;

  @IsInt()
  @Min(1)
  @Max(MAX_TRACK_BYTES)
  sizeBytes: number;

  /** Defaults to the file name without its extension. */
  @trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  /** Defaults to the next number on the album. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  trackNumber?: number;

  /** Defaults to the album artist. */
  @IsOptional()
  @IsUUID()
  artistId?: string;
}

export class UpdateTrackDto {
  @trim()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(999)
  trackNumber?: number;

  @IsOptional()
  @IsUUID()
  artistId?: string;

  /** Plain text or LRC ("[01:23.45] line"). null or "" removes the lyrics. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @MaxLength(MAX_LYRICS_LENGTH)
  lyrics?: string | null;
}
