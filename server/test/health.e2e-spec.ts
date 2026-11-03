import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/prisma/prisma.service';

describe('GET /api/health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports the database as up', async () => {
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('returns 503 when the database query fails', async () => {
    const prisma = app.get(PrismaService);
    const spy = jest.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection lost'));
    const res = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(res.body).toEqual({ status: 'error', db: 'down' });
    spy.mockRestore();
  });

  it('liveness does not depend on the database', async () => {
    const prisma = app.get(PrismaService);
    const spy = jest.spyOn(prisma, '$queryRaw').mockRejectedValue(new Error('connection lost'));
    await request(app.getHttpServer()).get('/api/health/live').expect(200, { status: 'ok' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
