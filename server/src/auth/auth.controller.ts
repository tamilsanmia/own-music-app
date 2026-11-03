import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { Env } from '../config/env';
import { AuthService } from './auth.service';
import { Public } from './decorators';
import { LoginDto, RefreshDto } from './dto';
import { clearRefreshCookie, readRefreshToken, sendSession } from './session-response';

@Public()
@Controller('auth')
export class AuthController {
  private readonly secureCookie: boolean;

  constructor(
    private readonly auth: AuthService,
    config: ConfigService<Env, true>,
  ) {
    this.secureCookie = config.get('NODE_ENV', { infer: true }) !== 'development';
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.login(dto.email, dto.password);
    return sendSession(res, session, dto.client ?? 'web', this.secureCookie);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = readRefreshToken(req, dto.refreshToken);
    if (!raw) throw new UnauthorizedException();
    // A token in the body means a mobile client; otherwise it came from the web cookie.
    const client = dto.refreshToken ? 'mobile' : 'web';
    try {
      const session = await this.auth.refresh(raw);
      return sendSession(res, session, client, this.secureCookie);
    } catch (err) {
      if (client === 'web') clearRefreshCookie(res, this.secureCookie);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body() dto: RefreshDto, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(readRefreshToken(req, dto.refreshToken));
    clearRefreshCookie(res, this.secureCookie);
  }
}
