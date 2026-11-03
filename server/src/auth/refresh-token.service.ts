import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

class TokenReuseError extends Error {}

/**
 * Opaque refresh tokens with rotation. Each use returns a new token in the same family and
 * revokes the old one. Presenting a revoked token means it was stolen or replayed, so the whole
 * family is revoked and the user has to log in again.
 */
@Injectable()
export class RefreshTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private newExpiry(): Date {
    const days = this.config.get('REFRESH_TTL_DAYS', { infer: true });
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  /** Start a new token family (a login). */
  async issue(userId: string): Promise<IssuedRefreshToken> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.newExpiry();
    await this.prisma.refreshToken.create({
      data: { tokenHash: hashToken(token), familyId: randomUUID(), userId, expiresAt },
    });
    return { token, expiresAt };
  }

  /** Exchange a refresh token for a new one. Returns the user id it belongs to. */
  async rotate(raw: string): Promise<IssuedRefreshToken & { userId: string }> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(raw) },
      include: { user: { select: { isActive: true } } },
    });
    if (!existing) throw new UnauthorizedException();

    if (existing.revokedAt) {
      await this.revokeFamily(existing.familyId);
      throw new UnauthorizedException();
    }
    if (existing.expiresAt <= new Date() || !existing.user.isActive) {
      throw new UnauthorizedException();
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = this.newExpiry();
    try {
      await this.prisma.$transaction(async (tx) => {
        const next = await tx.refreshToken.create({
          data: {
            tokenHash: hashToken(token),
            familyId: existing.familyId,
            userId: existing.userId,
            expiresAt,
          },
        });
        // Conditional update: if a concurrent request already rotated this token, count is 0.
        const { count } = await tx.refreshToken.updateMany({
          where: { id: existing.id, revokedAt: null },
          data: { revokedAt: new Date(), replacedById: next.id },
        });
        if (count !== 1) throw new TokenReuseError();
      });
    } catch (err) {
      if (err instanceof TokenReuseError) {
        await this.revokeFamily(existing.familyId);
        throw new UnauthorizedException();
      }
      throw err;
    }
    return { token, expiresAt, userId: existing.userId };
  }

  /** Revoke the family that a raw token belongs to (logout). Unknown tokens are ignored. */
  async revokeByToken(raw: string): Promise<void> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(raw) },
      select: { familyId: true },
    });
    if (existing) await this.revokeFamily(existing.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Log a user out everywhere (password change, deactivation). */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
