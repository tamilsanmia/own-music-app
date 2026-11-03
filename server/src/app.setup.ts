import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Env } from './config/env';

/** Shared HTTP setup used by main.ts and by e2e tests, so tests exercise the real configuration. */
export function configureApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // One proxy hop (Traefik) in front of the pod: req.ip is the client address from
  // X-Forwarded-For, which the login rate limit keys on.
  (app as NestExpressApplication).set('trust proxy', 1);

  app.setGlobalPrefix('api', { exclude: ['stream/{*path}', 'media/{*path}'] });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.enableCors({ origin: config.get('CORS_ORIGIN', { infer: true }), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
}
