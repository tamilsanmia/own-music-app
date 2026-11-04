import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role, User } from '@prisma/client';
import { PasswordService } from '../auth/password.service';
import { RefreshTokenService } from '../auth/refresh-token.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActiveUserCache } from '../stream/active-user.cache';

/** The user fields that are safe to return from the API. */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  isActive: boolean;
  createdAt: Date;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    role: u.role,
    isActive: u.isActive,
    createdAt: u.createdAt,
  };
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly activeUsers: ActiveUserCache,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async list(): Promise<PublicUser[]> {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map(toPublicUser);
  }

  async create(input: {
    email: string;
    displayName: string;
    password: string;
    role?: Role;
  }): Promise<PublicUser> {
    try {
      const user = await this.prisma.user.create({
        data: {
          email: normalizeEmail(input.email),
          displayName: input.displayName.trim(),
          passwordHash: await this.passwords.hash(input.password),
          role: input.role ?? Role.USER,
        },
      });
      return toPublicUser(user);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A user with this email already exists');
      }
      throw err;
    }
  }

  /** Admin update of another account. Deactivating or resetting a password ends its sessions. */
  async adminUpdate(
    actorId: string,
    id: string,
    input: { displayName?: string; isActive?: boolean; password?: string },
  ): Promise<PublicUser> {
    if (id === actorId && input.isActive === false) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    const existing = await this.findById(id);
    if (!existing) throw new NotFoundException();

    const user = await this.prisma.user.update({
      where: { id },
      data: {
        displayName: input.displayName?.trim(),
        isActive: input.isActive,
        passwordHash: input.password ? await this.passwords.hash(input.password) : undefined,
      },
    });
    if (input.password || input.isActive === false) {
      await this.refreshTokens.revokeAllForUser(id);
    }
    // Stream links check the active flag through a short cache; make the change take effect now.
    if (input.isActive !== undefined) this.activeUsers.forget(id);
    return toPublicUser(user);
  }

  async updateOwnProfile(id: string, displayName: string): Promise<User> {
    if (!(await this.findById(id))) throw new NotFoundException();
    return this.prisma.user.update({ where: { id }, data: { displayName: displayName.trim() } });
  }

  /** The user changes their own password. Ends all of their sessions. */
  async changeOwnPassword(id: string, currentPassword: string, newPassword: string): Promise<User> {
    const user = await this.findById(id);
    if (!user || !(await this.passwords.verify(user.passwordHash, currentPassword))) {
      throw new BadRequestException('Current password is incorrect');
    }
    const updated = await this.prisma.user.update({
      where: { id },
      data: { passwordHash: await this.passwords.hash(newPassword) },
    });
    await this.refreshTokens.revokeAllForUser(id);
    return updated;
  }
}
