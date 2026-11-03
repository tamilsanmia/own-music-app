import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LOGIN_LIMIT_PER_MINUTE } from '../src/auth/auth.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ADMIN, adminToken, createListener, createTestApp, login, refreshCookie, resetDb } from './helpers';

describe('Auth', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(() => resetDb(app));
  afterAll(() => app.close());

  describe('admin seed', () => {
    it('creates the admin from env on startup', async () => {
      const admin = await app.get(PrismaService).user.findUnique({ where: { email: ADMIN.email } });
      expect(admin).toMatchObject({ role: 'ADMIN', isActive: true });
      expect(admin!.passwordHash).not.toContain(ADMIN.password);
    });
  });

  describe('POST /api/auth/login', () => {
    it('returns tokens and the user for valid credentials (mobile)', async () => {
      const res = await login(app, ADMIN.email, ADMIN.password, 'mobile').expect(200);
      expect(res.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        expiresIn: 900,
        user: { email: ADMIN.email, role: 'ADMIN' },
      });
      expect(res.body.user.passwordHash).toBeUndefined();
      expect(refreshCookie(res)).toBeUndefined();
    });

    it('sets an httpOnly, Secure, SameSite=Strict cookie for web and keeps the token out of the body', async () => {
      const res = await login(app, ADMIN.email, ADMIN.password, 'web').expect(200);
      expect(res.body.refreshToken).toBeUndefined();
      const header = ([] as string[]).concat(res.headers['set-cookie']).join(';');
      expect(header).toMatch(/music_rt=/);
      expect(header).toMatch(/HttpOnly/i);
      expect(header).toMatch(/Secure/i);
      expect(header).toMatch(/SameSite=Strict/i);
      expect(header).toMatch(/Path=\/api\/auth/);
    });

    it('accepts the email in any case', async () => {
      await login(app, ADMIN.email.toUpperCase(), ADMIN.password).expect(200);
    });

    it('rejects a wrong password and an unknown email with the same 401', async () => {
      const wrong = await login(app, ADMIN.email, 'wrong-password').expect(401);
      const unknown = await login(app, 'nobody@test.local', 'whatever-123').expect(401);
      expect(wrong.body.message).toBe(unknown.body.message);
    });

    it('rejects malformed input with 400', async () => {
      await http().post('/api/auth/login').send({ email: 'not-an-email', password: 'x' }).expect(400);
      await http()
        .post('/api/auth/login')
        .send({ email: ADMIN.email, password: ADMIN.password, role: 'ADMIN' })
        .expect(400);
    });

    it(`rate-limits to ${LOGIN_LIMIT_PER_MINUTE} attempts per minute per IP`, async () => {
      const ip = '203.0.113.7';
      for (let i = 0; i < LOGIN_LIMIT_PER_MINUTE; i++) {
        await http()
          .post('/api/auth/login')
          .set('X-Forwarded-For', ip)
          .send({ email: ADMIN.email, password: 'wrong-password' })
          .expect(401);
      }
      await http()
        .post('/api/auth/login')
        .set('X-Forwarded-For', ip)
        .send({ email: ADMIN.email, password: ADMIN.password })
        .expect(429);
      // A different client IP is unaffected.
      await login(app, ADMIN.email, ADMIN.password).expect(200);
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('rotates a mobile refresh token from the body', async () => {
      const first = (await login(app, ADMIN.email, ADMIN.password)).body;
      const res = await http().post('/api/auth/refresh').send({ refreshToken: first.refreshToken }).expect(200);
      expect(res.body.refreshToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).not.toBe(first.refreshToken);
      await http().get('/api/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    });

    it('rotates a web refresh token from the cookie', async () => {
      const cookie = refreshCookie(await login(app, ADMIN.email, ADMIN.password, 'web'));
      const res = await http().post('/api/auth/refresh').set('Cookie', `music_rt=${cookie}`).expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toBeUndefined();
      const next = refreshCookie(res);
      expect(next).toBeDefined();
      expect(next).not.toBe(cookie);
    });

    it('revokes the whole family when an old token is reused', async () => {
      const t1 = (await login(app, ADMIN.email, ADMIN.password)).body.refreshToken;
      const t2 = (await http().post('/api/auth/refresh').send({ refreshToken: t1 }).expect(200)).body.refreshToken;

      await http().post('/api/auth/refresh').send({ refreshToken: t1 }).expect(401);
      // The legitimate newer token is now dead too.
      await http().post('/api/auth/refresh').send({ refreshToken: t2 }).expect(401);
    });

    it('does not affect other sessions of the same user', async () => {
      const a = (await login(app, ADMIN.email, ADMIN.password)).body.refreshToken;
      const b = (await login(app, ADMIN.email, ADMIN.password)).body.refreshToken;
      await http().post('/api/auth/refresh').send({ refreshToken: a }).expect(200);
      await http().post('/api/auth/refresh').send({ refreshToken: a }).expect(401);
      await http().post('/api/auth/refresh').send({ refreshToken: b }).expect(200);
    });

    it('returns 401 without a token', async () => {
      await http().post('/api/auth/refresh').send({}).expect(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('revokes the refresh token and clears the cookie', async () => {
      const cookie = refreshCookie(await login(app, ADMIN.email, ADMIN.password, 'web'));
      const res = await http().post('/api/auth/logout').set('Cookie', `music_rt=${cookie}`).expect(204);
      expect(([] as string[]).concat(res.headers['set-cookie']).join(';')).toMatch(/music_rt=;/);
      await http().post('/api/auth/refresh').set('Cookie', `music_rt=${cookie}`).expect(401);
    });
  });

  describe('access tokens', () => {
    it('rejects missing, malformed and forged tokens', async () => {
      await http().get('/api/me').expect(401);
      await http().get('/api/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
      const real = await adminToken(app);
      const [h, p] = real.split('.');
      await http().get('/api/me').set('Authorization', `Bearer ${h}.${p}.forgedsignature`).expect(401);
    });
  });
});

describe('Users', () => {
  let app: INestApplication;
  let admin: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetDb(app);
    admin = await adminToken(app);
  });
  afterAll(() => app.close());

  it('admin creates a listener who can log in and read /api/me', async () => {
    const listener = await createListener(app, admin, 'New.Listener@Test.local');
    expect(listener).toMatchObject({ email: 'new.listener@test.local', role: 'USER', isActive: true });

    const session = (await login(app, 'new.listener@test.local', listener.password)).body;
    const me = await http().get('/api/me').set('Authorization', `Bearer ${session.accessToken}`).expect(200);
    expect(me.body).toMatchObject({ email: 'new.listener@test.local', role: 'USER', displayName: 'Listener' });
  });

  it('rejects duplicate emails with 409', async () => {
    await createListener(app, admin);
    await http()
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${admin}`)
      .send({ email: 'LISTENER@test.local', password: 'another-pass', displayName: 'Dup' })
      .expect(409);
  });

  it('does not let the admin create another admin through the API', async () => {
    await http()
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${admin}`)
      .send({ email: 'x@test.local', password: 'password-123', displayName: 'X', role: 'ADMIN' })
      .expect(400);
  });

  it('forbids admin routes to listeners', async () => {
    const listener = await createListener(app, admin);
    const token = (await login(app, listener.email, listener.password)).body.accessToken;
    await http().get('/api/admin/users').set('Authorization', `Bearer ${token}`).expect(403);
    await http()
      .post('/api/admin/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'y@test.local', password: 'password-123', displayName: 'Y' })
      .expect(403);
  });

  it('lists users for the admin', async () => {
    await createListener(app, admin);
    const res = await http().get('/api/admin/users').set('Authorization', `Bearer ${admin}`).expect(200);
    expect(res.body.map((u: { email: string }) => u.email)).toEqual([ADMIN.email, 'listener@test.local']);
    expect(res.body[0].passwordHash).toBeUndefined();
  });

  it('a deactivated user cannot log in, refresh, or use an existing access token', async () => {
    const listener = await createListener(app, admin);
    const session = (await login(app, listener.email, listener.password)).body;

    await http()
      .patch(`/api/admin/users/${listener.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ isActive: false })
      .expect(200);

    await login(app, listener.email, listener.password).expect(401);
    await http().post('/api/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
    await http().get('/api/me').set('Authorization', `Bearer ${session.accessToken}`).expect(401);

    // Reactivating lets them log in again.
    await http()
      .patch(`/api/admin/users/${listener.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ isActive: true })
      .expect(200);
    await login(app, listener.email, listener.password).expect(200);
  });

  it('admin password reset ends existing sessions', async () => {
    const listener = await createListener(app, admin);
    const session = (await login(app, listener.email, listener.password)).body;
    await http()
      .patch(`/api/admin/users/${listener.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ password: 'reset-password-1' })
      .expect(200);

    await http().post('/api/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401);
    await login(app, listener.email, listener.password).expect(401);
    await login(app, listener.email, 'reset-password-1').expect(200);
  });

  it('the admin cannot deactivate their own account', async () => {
    const me = await http().get('/api/me').set('Authorization', `Bearer ${admin}`).expect(200);
    await http()
      .patch(`/api/admin/users/${me.body.id}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ isActive: false })
      .expect(400);
  });

  it('returns 404 for an unknown user and 400 for a non-UUID id', async () => {
    await http()
      .patch('/api/admin/users/00000000-0000-4000-8000-000000000000')
      .set('Authorization', `Bearer ${admin}`)
      .send({ displayName: 'Ghost' })
      .expect(404);
    await http().patch('/api/admin/users/123').set('Authorization', `Bearer ${admin}`).send({}).expect(400);
  });

  describe('PATCH /api/me/password', () => {
    it('changes the password, ends other sessions, and returns a new session', async () => {
      const listener = await createListener(app, admin);
      const s1 = (await login(app, listener.email, listener.password)).body;
      const s2 = (await login(app, listener.email, listener.password)).body;

      const res = await http()
        .patch('/api/me/password')
        .set('Authorization', `Bearer ${s1.accessToken}`)
        .send({ currentPassword: listener.password, newPassword: 'brand-new-pass', client: 'mobile' })
        .expect(200);
      expect(res.body.refreshToken).toEqual(expect.any(String));

      await http().post('/api/auth/refresh').send({ refreshToken: s2.refreshToken }).expect(401);
      await http().post('/api/auth/refresh').send({ refreshToken: res.body.refreshToken }).expect(200);
      await login(app, listener.email, 'brand-new-pass').expect(200);
    });

    it('rejects a wrong current password', async () => {
      const listener = await createListener(app, admin);
      const s = (await login(app, listener.email, listener.password)).body;
      await http()
        .patch('/api/me/password')
        .set('Authorization', `Bearer ${s.accessToken}`)
        .send({ currentPassword: 'wrong-one', newPassword: 'brand-new-pass' })
        .expect(400);
    });
  });
});
