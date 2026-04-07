import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApplication } from './helpers/create-e2e-app';
import { assertErrorEnvelope, assertSuccessEnvelope } from './helpers/http-contract';

describe('Users (e2e)', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;

  const firstEmail = `e2e-users-${randomUUID()}@example.com`.toLowerCase();
  const secondEmail = `e2e-users-${randomUUID()}@example.com`.toLowerCase();
  const thirdEmail = `e2e-users-${randomUUID()}@example.com`.toLowerCase();
  const firstPassword = 'UserFlowA1';
  const secondPassword = 'UserFlowB1';
  const updatedPassword = 'UpdatedC1';

  function httpServer(): Server {
    if (!app) throw new Error('E2E application not initialized');
    return app.getHttpServer();
  }

  async function registerAndLogin(
    email: string,
    password: string,
    name: string,
    phone: string,
  ): Promise<{ accessToken: string; userId: string }> {
    const registerRes = await request(httpServer())
      .post('/auth/register')
      .send({ email, password, name, phone })
      .expect(201);
    assertSuccessEnvelope(registerRes.body);

    const loginRes = await request(httpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    assertSuccessEnvelope(loginRes.body);

    const data = loginRes.body.data as {
      accessToken: string;
      user: { id: string };
    };
    return { accessToken: data.accessToken, userId: data.user.id };
  }

  jest.setTimeout(60_000);

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        const customers = await prisma.customer.findMany({
          where: { email: { in: [firstEmail, secondEmail, thirdEmail] } },
          select: { id: true },
        });
        const ids = customers.map((c) => c.id);
        if (ids.length) {
          await prisma.auditLog.deleteMany({ where: { customerId: { in: ids } } });
          await prisma.refreshToken.deleteMany({
            where: { customerId: { in: ids } },
          });
          await prisma.customer.deleteMany({ where: { id: { in: ids } } });
        }
      }
    } finally {
      await app?.close();
    }
  });

  it('GET /users/me returns current user profile', async () => {
    const { accessToken } = await registerAndLogin(
      firstEmail,
      firstPassword,
      'Users E2E One',
      '5551111111',
    );

    const res = await request(httpServer())
      .get('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    assertSuccessEnvelope(res.body, (p) => expect(p).toContain('/users/me'));
    expect(res.body.data).toMatchObject({
      id: expect.any(String),
      email: firstEmail,
      name: 'Users E2E One',
      phone: '5551111111',
      accounts: expect.any(Array),
    });
  });

  it('PUT /users/me updates profile fields', async () => {
    const { accessToken } = await registerAndLogin(
      secondEmail,
      secondPassword,
      'Users E2E Two',
      '5552222222',
    );

    const res = await request(httpServer())
      .put('/users/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'Users E2E Two Updated',
        phone: '5553333333',
      })
      .expect(200);

    assertSuccessEnvelope(res.body, (p) => expect(p).toContain('/users/me'));
    expect(res.body.data).toMatchObject({
      id: expect.any(String),
      email: secondEmail,
      name: 'Users E2E Two Updated',
      phone: '5553333333',
      accounts: expect.any(Array),
    });
  });

  it('PATCH /users/me/password rejects wrong old password and accepts valid change', async () => {
    const { accessToken } = await registerAndLogin(
      thirdEmail,
      'CurrentD1',
      'Users E2E Three',
      '5554444444',
    );

    const wrongOld = await request(httpServer())
      .patch('/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        oldPassword: 'WrongX1',
        newPassword: updatedPassword,
      })
      .expect(401);

    assertErrorEnvelope(wrongOld.body, 401, (p) => expect(p).toContain('/users/me/password'));
    expect(wrongOld.body.error.message).toBe('Invalid credentials');

    const ok = await request(httpServer())
      .patch('/users/me/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        oldPassword: 'CurrentD1',
        newPassword: updatedPassword,
      })
      .expect(200);

    assertSuccessEnvelope(ok.body, (p) => expect(p).toContain('/users/me/password'));
    expect(ok.body.data).toEqual({ message: 'Password updated successfully' });
  });
});
