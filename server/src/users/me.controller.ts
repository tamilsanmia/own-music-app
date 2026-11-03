import { Body, Controller, Get, NotFoundException, Patch, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { ChangePasswordDto } from '../auth/dto';
import { sendSession } from '../auth/session-response';
import type { Env } from '../config/env';
import { toPublicUser, UsersService } from './users.service';

@Controller('me')
export class MeController {
  private readonly secureCookie: boolean;

  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
    config: ConfigService<Env, true>,
  ) {
    this.secureCookie = config.get('NODE_ENV', { infer: true }) !== 'development';
  }

  @Get()
  async me(@CurrentUser() current: AuthUser) {
    const user = await this.users.findById(current.id);
    if (!user) throw new NotFoundException();
    return toPublicUser(user);
  }

  /** Changes the password, ends every other session, and returns a new session for this client. */
  @Patch('password')
  async changePassword(
    @CurrentUser() current: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const user = await this.users.changeOwnPassword(current.id, dto.currentPassword, dto.newPassword);
    const session = await this.auth.newSession(user);
    return sendSession(res, session, dto.client ?? 'web', this.secureCookie);
  }
}
