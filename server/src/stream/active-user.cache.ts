import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** How long a user's active flag is trusted before it's re-read from the database. */
export const ACTIVE_USER_CACHE_MS = 60_000;
const MAX_ENTRIES = 10_000;

/**
 * Stream segments are fetched every few seconds per listener, so the "is this user still
 * active?" check is cached briefly instead of querying the database on every segment.
 */
@Injectable()
export class ActiveUserCache {
  private readonly entries = new Map<string, { active: boolean; until: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async isActive(userId: string, now = Date.now()): Promise<boolean> {
    const hit = this.entries.get(userId);
    if (hit && hit.until > now) return hit.active;

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
    const active = user?.isActive === true;
    if (this.entries.size >= MAX_ENTRIES) this.entries.clear();
    this.entries.set(userId, { active, until: now + ACTIVE_USER_CACHE_MS });
    return active;
  }

  /** Forget everything (tests, or after an admin deactivates someone). */
  clear(): void {
    this.entries.clear();
  }

  forget(userId: string): void {
    this.entries.delete(userId);
  }
}
