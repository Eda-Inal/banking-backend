import { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import request from 'supertest';
import { createE2eApplication } from './helpers/create-e2e-app';
import { assertErrorEnvelope, assertSuccessEnvelope } from './helpers/http-contract';

describe('Response Contract (e2e)', () => {
  let app: INestApplication | undefined;

  function httpServer(): Server {
    if (!app) throw new Error('E2E application not initialized');
    return app.getHttpServer();
  }

  beforeAll(async () => {
    app = await createE2eApplication();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('success responses include success/data/meta/timestamp/path', async () => {
    const res = await request(httpServer()).get('/').expect(200);

    assertSuccessEnvelope(res.body, (path) => expect(path).toBe('/'));
    expect(res.body.data).toBe('Hello World!');
  });

  it('error responses include success=false,error.statusCode,error.message,timestamp,path', async () => {
    const res = await request(httpServer()).get('/users/me').expect(401);

    assertErrorEnvelope(res.body, 401, (path) => expect(path).toContain('/users/me'));
  });
});
