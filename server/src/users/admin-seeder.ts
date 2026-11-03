import { ConflictException, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import type { Env } from '../config/env';
import { UsersService } from './users.service';

/**
 * Creates the admin account from ADMIN_EMAIL / ADMIN_PASSWORD on startup if it doesn't exist.
 * An existing account is never modified, so changing ADMIN_PASSWORD later has no effect;
 * change the password in the app instead.
 */
@Injectable()
export class AdminSeeder implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminSeeder.name);

  constructor(
    private readonly users: UsersService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const email = this.config.get('ADMIN_EMAIL', { infer: true });
    const password = this.config.get('ADMIN_PASSWORD', { infer: true });
    if (!email || !password) {
      this.logger.warn('ADMIN_EMAIL/ADMIN_PASSWORD not set; skipping admin seed');
      return;
    }
    if (await this.users.findByEmail(email)) return;

    try {
      await this.users.create({ email, password, displayName: 'Admin', role: Role.ADMIN });
      this.logger.log(`Created admin account ${email}`);
    } catch (err) {
      // Another replica created it at the same moment.
      if (!(err instanceof ConflictException)) throw err;
    }
  }
}
