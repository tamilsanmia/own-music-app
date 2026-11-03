import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import type { Env } from '../config/env';
import { PublicUser, toPublicUser, UsersService } from '../users/users.service';
import type { AccessTokenPayload } from './guards';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';

export interface Session {
  accessToken: string;
  /** Access token lifetime in seconds. */
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: PublicUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async login(email: string, password: string): Promise<Session> {
    const user = await this.users.findByEmail(email);
    const ok = user
      ? await this.passwords.verify(user.passwordHash, password)
      : await this.passwords.verifyDummy(password);
    // Same error for unknown email, wrong password and deactivated account.
    if (!user || !ok || !user.isActive) throw new UnauthorizedException('Invalid email or password');

    const refresh = await this.refreshTokens.issue(user.id);
    return this.buildSession(user, refresh.token, refresh.expiresAt);
  }

  async refresh(rawRefreshToken: string): Promise<Session> {
    const rotated = await this.refreshTokens.rotate(rawRefreshToken);
    const user = await this.users.findById(rotated.userId);
    if (!user || !user.isActive) throw new UnauthorizedException();
    return this.buildSession(user, rotated.token, rotated.expiresAt);
  }

  async logout(rawRefreshToken: string | undefined): Promise<void> {
    if (rawRefreshToken) await this.refreshTokens.revokeByToken(rawRefreshToken);
  }

  /** Start a fresh session for a user who is already authenticated (e.g. after a password change). */
  async newSession(user: User): Promise<Session> {
    const refresh = await this.refreshTokens.issue(user.id);
    return this.buildSession(user, refresh.token, refresh.expiresAt);
  }

  private async buildSession(user: User, refreshToken: string, refreshExpiresAt: Date): Promise<Session> {
    const payload: AccessTokenPayload = { sub: user.id, role: user.role };
    return {
      accessToken: await this.jwt.signAsync(payload),
      expiresIn: this.config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }),
      refreshToken,
      refreshExpiresAt,
      user: toPublicUser(user),
    };
  }
}
