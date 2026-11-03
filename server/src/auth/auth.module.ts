import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Env } from '../config/env';
import { AdminSeeder } from '../users/admin-seeder';
import { AdminUsersController } from '../users/admin-users.controller';
import { MeController } from '../users/me.controller';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, RolesGuard } from './guards';
import { PasswordService } from './password.service';
import { RefreshTokenService } from './refresh-token.service';

/** Login rate limit: attempts per client IP per minute. Applied only to POST /api/auth/login. */
export const LOGIN_LIMIT_PER_MINUTE = 10;

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256', expiresIn: config.get('JWT_ACCESS_TTL_SECONDS', { infer: true }) },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: LOGIN_LIMIT_PER_MINUTE }]),
  ],
  controllers: [AuthController, MeController, AdminUsersController],
  providers: [
    AuthService,
    PasswordService,
    RefreshTokenService,
    UsersService,
    AdminSeeder,
    // Order matters: authenticate first, then check roles.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [AuthService, UsersService, RefreshTokenService, JwtModule],
})
export class AuthModule {}
