import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2eApplication } from './helpers/create-e2e-app';
import { assertSuccessEnvelope } from './helpers/http-contract';

describe('AppController (e2e)', () => {
  let app: INestApplication | undefined;

  beforeAll(async () => {
    app = await createE2eApplication();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET / returns the success envelope', async () => {
    if (!app) {
      throw new Error('E2E application not initialized');
    }
    const res = await request(app.getHttpServer()).get('/').expect(200);
    assertSuccessEnvelope(res.body, (p) => expect(p).toBe('/'));
    expect(res.body.data).toBe('Hello World!');
  });
});
