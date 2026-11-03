import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import { hashToken, RefreshTokenService } from './refresh-token.service';

interface Row {
  id: string;
  tokenHash: string;
  familyId: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: string | null;
}

/** Minimal in-memory stand-in for the Prisma calls RefreshTokenService makes. */
function fakePrisma(userActive = () => true) {
  const rows: Row[] = [];
  let seq = 0;
  const matches = (r: Row, where: Partial<Row>) =>
    Object.entries(where).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v);

  const refreshToken = {
    create: async ({ data }: { data: Omit<Row, 'id' | 'revokedAt' | 'replacedById'> }) => {
      const row: Row = { id: `id-${++seq}`, revokedAt: null, replacedById: null, ...data };
      rows.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: { tokenHash: string } }) => {
      const row = rows.find((r) => r.tokenHash === where.tokenHash);
      return row ? { ...row, user: { isActive: userActive() } } : null;
    },
    updateMany: async ({ where, data }: { where: Partial<Row>; data: Partial<Row> }) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
  };
  const prisma = {
    refreshToken,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ refreshToken }),
  };
  return { prisma: prisma as unknown as PrismaService, rows };
}

const config = { get: () => 30 } as unknown as ConfigService<never, true>;

describe('RefreshTokenService', () => {
  it('stores only a hash of the token', async () => {
    const { prisma, rows } = fakePrisma();
    const { token } = await new RefreshTokenService(prisma, config).issue('u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).toBe(hashToken(token));
    expect(rows[0].tokenHash).not.toContain(token);
  });

  it('rotates a token within the same family and revokes the old one', async () => {
    const { prisma, rows } = fakePrisma();
    const svc = new RefreshTokenService(prisma, config);
    const first = await svc.issue('u1');
    const second = await svc.rotate(first.token);

    expect(second.userId).toBe('u1');
    expect(second.token).not.toBe(first.token);
    expect(rows).toHaveLength(2);
    expect(rows[1].familyId).toBe(rows[0].familyId);
    expect(rows[0].revokedAt).toBeInstanceOf(Date);
    expect(rows[0].replacedById).toBe(rows[1].id);
    expect(rows[1].revokedAt).toBeNull();
  });

  it('revokes the whole family when a rotated token is reused', async () => {
    const { prisma, rows } = fakePrisma();
    const svc = new RefreshTokenService(prisma, config);
    const first = await svc.issue('u1');
    const second = await svc.rotate(first.token);

    await expect(svc.rotate(first.token)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
    await expect(svc.rotate(second.token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects unknown tokens', async () => {
    const { prisma } = fakePrisma();
    await expect(new RefreshTokenService(prisma, config).rotate('nope')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects expired tokens', async () => {
    const { prisma, rows } = fakePrisma();
    const svc = new RefreshTokenService(prisma, config);
    const { token } = await svc.issue('u1');
    rows[0].expiresAt = new Date(Date.now() - 1000);
    await expect(svc.rotate(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects tokens of deactivated users', async () => {
    let active = true;
    const { prisma } = fakePrisma(() => active);
    const svc = new RefreshTokenService(prisma, config);
    const { token } = await svc.issue('u1');
    active = false;
    await expect(svc.rotate(token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('treats a lost race (token already rotated concurrently) as reuse', async () => {
    const { prisma, rows } = fakePrisma();
    const svc = new RefreshTokenService(prisma, config);
    const { token } = await svc.issue('u1');
    // Simulate another request revoking the row between the read and the conditional update.
    const original = prisma.refreshToken.findUnique.bind(prisma.refreshToken);
    jest.spyOn(prisma.refreshToken, 'findUnique').mockImplementationOnce((async (args: never) => {
      const found = await original(args);
      rows[0].revokedAt = new Date();
      return found;
    }) as never);

    await expect(svc.rotate(token)).rejects.toBeInstanceOf(UnauthorizedException);
    // The family is revoked, including the row this fake (which has no rollback) left behind.
    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });
});
