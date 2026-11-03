import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import type { ClientKind } from './session-response';

const CLIENTS: ClientKind[] = ['web', 'mobile'];

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email: string;

  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password: string;

  @IsOptional()
  @IsIn(CLIENTS)
  client?: ClientKind;
}

export class RefreshDto {
  /** Mobile clients send the token here; web clients rely on the cookie. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  refreshToken?: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;

  @IsOptional()
  @IsIn(CLIENTS)
  client?: ClientKind;
}
