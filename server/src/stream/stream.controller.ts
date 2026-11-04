import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common';
import { TrackStatus } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { HLS_VARIANTS, LOSSLESS_DIR, LOSSLESS_PLAYLIST } from '../audio/ffmpeg';
import { AuthUser, CurrentUser, Public } from '../auth/decorators';
import { MediaService } from '../media/media.service';
import { PrismaService } from '../prisma/prisma.service';
import { ActiveUserCache } from './active-user.cache';
import { StreamTokenService } from './stream-token.service';

/**
 * The only files a stream URL can reach, relative to hls/<trackId>/. Anything else is a 404,
 * so path tricks like "../" never get near the filesystem.
 */
const variantNames = HLS_VARIANTS.map((v) => v.name).join('|');
const ALLOWED_PATH = new RegExp(
  `^(?:master\\.m3u8|(?:${variantNames})/(?:index\\.m3u8|init_\\d{1,2}\\.mp4|seg_\\d{3,6}\\.m4s)` +
    `|${LOSSLESS_PLAYLIST.replace('.', '\\.')}|${LOSSLESS_DIR}/(?:index\\.m3u8|init\\.mp4|seg_\\d{3,6}\\.m4s))$`,
);

class StreamUrlQuery {
  /** "lossless" asks for the FLAC stream; tracks without one get the normal AAC stream. */
  @IsOptional()
  @IsIn(['auto', 'lossless'])
  quality?: 'auto' | 'lossless';
}

function contentType(path: string): string {
  return path.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'audio/mp4';
}

/** GET /api/tracks/:id/stream-url, for any logged-in user. */
@Controller('tracks')
export class StreamUrlController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: StreamTokenService,
  ) {}

  @Get(':id/stream-url')
  async streamUrl(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: StreamUrlQuery,
  ) {
    const track = await this.prisma.track.findFirst({
      where: { id, status: TrackStatus.READY },
      select: { id: true, lossless: true },
    });
    if (!track) throw new NotFoundException('Track not found');
    const { token, expiresAt } = this.tokens.sign(user.id, track.id);
    const lossless = query.quality === 'lossless' && track.lossless;
    const playlist = lossless ? LOSSLESS_PLAYLIST : 'master.m3u8';
    return { url: `/stream/${token}/${track.id}/${playlist}`, expiresAt, lossless };
  }
}

/**
 * GET /stream/<token>/<trackId>/<file>. No Authorization header: the token in the path is the
 * credential, so <audio>, hls.js and ExoPlayer can fetch playlists and segments directly.
 */
@Public()
@Controller('stream')
export class StreamController {
  constructor(
    private readonly tokens: StreamTokenService,
    private readonly activeUsers: ActiveUserCache,
    private readonly media: MediaService,
  ) {}

  @Get(':token/:trackId/*path')
  async serve(
    @Param('token') token: string,
    @Param('trackId') trackId: string,
    @Param('path') rawPath: string | string[],
    @Res() res: Response,
  ) {
    const check = this.tokens.verify(token, trackId);
    if (!check.ok) throw new ForbiddenException('Invalid or expired stream link');
    // Deactivated users lose access within the cache window, not only when the token expires.
    if (!(await this.activeUsers.isActive(check.claims.userId))) throw new ForbiddenException('Invalid or expired stream link');

    const path = Array.isArray(rawPath) ? rawPath.join('/') : rawPath;
    if (!ALLOWED_PATH.test(path)) throw new NotFoundException();

    const remaining = Math.max(0, check.claims.exp - Math.floor(Date.now() / 1000));
    res.sendFile(
      path,
      {
        root: this.media.hlsDir(check.claims.trackId),
        dotfiles: 'deny',
        cacheControl: false,
        headers: {
          'Content-Type': contentType(path),
          // Per-user URL: browsers may cache it until the token expires; shared caches may not.
          'Cache-Control': `private, max-age=${remaining}`,
          // Chromecast receivers load these from their own origin (CORS is set in app.setup.ts).
          'Cross-Origin-Resource-Policy': 'cross-origin',
        },
      },
      (err?: Error & { status?: number; statusCode?: number }) => {
        if (!err || res.headersSent) return;
        const status = err.status ?? err.statusCode ?? 500;
        res.status(status === 404 ? 404 : 500).json({ statusCode: status === 404 ? 404 : 500, message: status === 404 ? 'Not Found' : 'Internal server error' });
      },
    );
  }
}
