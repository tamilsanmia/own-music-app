import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { join } from 'node:path';
import type { Env } from './config/env';

/** Shared HTTP setup used by main.ts and by e2e tests, so tests exercise the real configuration. */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // One proxy hop (Traefik) in front of the pod: req.ip is the client address from
  // X-Forwarded-For, which the login rate limit keys on.
  (app as NestExpressApplication).set('trust proxy', 1);

  app.setGlobalPrefix('api', { exclude: ['stream/{*path}', 'media/{*path}'] });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));

  // Cover art is public: file names are random UUIDs and a new one is used on every upload, so
  // the files never change and can be cached forever. Only covers/ is exposed; audio under
  // originals/ and hls/ is served by the signed /stream endpoint (Task 7).
  (app as NestExpressApplication).useStaticAssets(join(config.get('MEDIA_ROOT', { infer: true }), 'covers'), {
    prefix: '/media/covers/',
    index: false,
    dotfiles: 'deny',
    redirect: false,
    immutable: true,
    maxAge: '365d',
  });
  app.use(cookieParser());
  app.enableCors({ origin: config.get('CORS_ORIGIN', { infer: true }), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
}
