import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

export const ADMIN = { email: process.env.ADMIN_EMAIL!, password: process.env.ADMIN_PASSWORD! };

let ipCounter = 0;
/** A distinct client IP per call, so tests don't share the per-IP login rate limit. */
export function freshIp(): string {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

/** Wipe all tables except the admin, which AdminSeeder created at startup. */
export async function resetDb(app: INestApplication): Promise<void> {
  const prisma = app.get(PrismaService);
  await prisma.playHistory.deleteMany();
  await prisma.likedTrack.deleteMany();
  await prisma.track.deleteMany();
  await prisma.album.deleteMany();
  await prisma.artist.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany({ where: { email: { not: ADMIN.email } } });
}

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}

export function login(
  app: INestApplication,
  email: string,
  password: string,
  client: 'web' | 'mobile' = 'mobile',
) {
  return request(app.getHttpServer())
    .post('/api/auth/login')
    .set('X-Forwarded-For', freshIp())
    .send({ email, password, client });
}

export async function adminToken(app: INestApplication): Promise<string> {
  const res = await login(app, ADMIN.email, ADMIN.password);
  if (res.status !== 200) throw new Error(`admin login failed: ${res.status}`);
  return res.body.accessToken;
}

export async function createListener(
  app: INestApplication,
  token: string,
  email = 'listener@test.local',
  password = 'listener-pass-1',
) {
  const res = await request(app.getHttpServer())
    .post('/api/admin/users')
    .set('Authorization', `Bearer ${token}`)
    .send({ email, password, displayName: 'Listener' })
    .expect(201);
  return { ...res.body, password } as { id: string; email: string; password: string };
}

/** Extract the refresh cookie value from a Set-Cookie header. */
export function refreshCookie(res: request.Response): string | undefined {
  const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
  const c = cookies.find((v) => v.startsWith('music_rt='));
  return c?.split(';')[0].slice('music_rt='.length) || undefined;
}
