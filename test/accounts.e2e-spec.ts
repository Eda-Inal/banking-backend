import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApplication } from './helpers/create-e2e-app';
import { assertSuccessEnvelope } from './helpers/http-contract';

describe('Accounts (e2e)', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;

  const email = `e2e-accounts-${randomUUID()}@example.com`.toLowerCase();
  const password = 'AccountsA1';

  function httpServer(): Server {
    if (!app) throw new Error('E2E application not initialized');
    return app.getHttpServer();
  }

  jest.setTimeout(60_000);

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        const customer = await prisma.customer.findUnique({
          where: { email },
          select: { id: true },
        });

        if (customer) {
          await prisma.auditLog.deleteMany({ where: { customerId: customer.id } });
          await prisma.refreshToken.deleteMany({ where: { customerId: customer.id } });
          await prisma.account.deleteMany({ where: { customerId: customer.id } });
          await prisma.customer.delete({ where: { id: customer.id } });
        }
      }
    } finally {
      await app?.close();
    }
  });

  it('POST /accounts and PATCH account lifecycle endpoints', async () => {
    const registerRes = await request(httpServer())
      .post('/auth/register')
      .send({
        email,
        password,
        name: 'Accounts E2E',
        phone: '5557777777',
      })
      .expect(201);
    assertSuccessEnvelope(registerRes.body);

    const loginRes = await request(httpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    assertSuccessEnvelope(loginRes.body);

    const accessToken = (loginRes.body.data as { accessToken: string }).accessToken;

    const createRes = await request(httpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currency: 'USD' })
      .expect(201);

    assertSuccessEnvelope(createRes.body, (p) => expect(p).toContain('/accounts'));
    expect(createRes.body.data).toMatchObject({
      id: expect.any(String),
      balance: '0',
      currency: 'USD',
      status: 'ACTIVE',
    });

    const accountId = (createRes.body.data as { id: string }).id;

    const freezeRes = await request(httpServer())
      .patch(`/accounts/${accountId}/freeze`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    assertSuccessEnvelope(freezeRes.body, (p) =>
      expect(p).toContain(`/accounts/${accountId}/freeze`),
    );
    expect(freezeRes.body.data).toMatchObject({
      id: accountId,
      currency: 'USD',
      status: 'FROZEN',
    });

    const unfreezeRes = await request(httpServer())
      .patch(`/accounts/${accountId}/unfreeze`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    assertSuccessEnvelope(unfreezeRes.body, (p) =>
      expect(p).toContain(`/accounts/${accountId}/unfreeze`),
    );
    expect(unfreezeRes.body.data).toMatchObject({
      id: accountId,
      currency: 'USD',
      status: 'ACTIVE',
    });

    const closeRes = await request(httpServer())
      .patch(`/accounts/${accountId}/close`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    assertSuccessEnvelope(closeRes.body, (p) =>
      expect(p).toContain(`/accounts/${accountId}/close`),
    );
    expect(closeRes.body.data).toMatchObject({
      id: accountId,
      currency: 'USD',
      status: 'CLOSED',
      balance: '0',
    });
  });
});
