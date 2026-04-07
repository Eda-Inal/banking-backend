import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import Redis from 'ioredis';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApplication } from './helpers/create-e2e-app';
import { assertErrorEnvelope, assertSuccessEnvelope } from './helpers/http-contract';

type AuthSession = {
  accessToken: string;
  userId: string;
  email: string;
};

describe('Transactions (e2e)', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;
  let redis: Redis | undefined;
  const createdEmails: string[] = [];

  function httpServer(): Server {
    if (!app) throw new Error('E2E application not initialized');
    return app.getHttpServer();
  }

  async function registerAndLogin(label: string): Promise<AuthSession> {
    const email = `e2e-transfers-${label}-${randomUUID()}@example.com`.toLowerCase();
    const password = 'TransferA1';

    const registerRes = await request(httpServer())
      .post('/auth/register')
      .send({
        email,
        password,
        name: `Transactions ${label}`,
        phone: '5556666666',
      })
      .expect(201);
    assertSuccessEnvelope(registerRes.body);

    const loginRes = await request(httpServer())
      .post('/auth/login')
      .send({ email, password })
      .expect(201);
    assertSuccessEnvelope(loginRes.body);

    createdEmails.push(email);
    const data = loginRes.body.data as {
      accessToken: string;
      user: { id: string };
    };
    return {
      accessToken: data.accessToken,
      userId: data.user.id,
      email,
    };
  }

  async function createAccount(
    accessToken: string,
    currency: 'USD' | 'EUR' | 'TRY',
  ): Promise<string> {
    const res = await request(httpServer())
      .post('/accounts')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currency })
      .expect(201);

    assertSuccessEnvelope(res.body, (p) => expect(p).toContain('/accounts'));
    return (res.body.data as { id: string }).id;
  }

  async function deposit(
    accessToken: string,
    toAccountId: string,
    amount: number,
    referenceId: string,
  ): Promise<void> {
    const res = await request(httpServer())
      .post('/transactions/deposit')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        toAccountId,
        amount,
        referenceId,
      })
      .expect(201);

    assertSuccessEnvelope(res.body, (p) => expect(p).toContain('/transactions/deposit'));
  }

  jest.setTimeout(60_000);

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
    const redisUrl = process.env.REDIS_URL_TEST ?? process.env.REDIS_URL;
    if (redisUrl) {
      redis = new Redis(redisUrl);
    }
  });

  afterAll(async () => {
    try {
      if (prisma && createdEmails.length) {
        const customers = await prisma.customer.findMany({
          where: { email: { in: createdEmails } },
          select: { id: true },
        });
        const ids = customers.map((c) => c.id);
        if (ids.length) {
          await prisma.auditLog.deleteMany({ where: { customerId: { in: ids } } });
          await prisma.refreshToken.deleteMany({
            where: { customerId: { in: ids } },
          });
          await prisma.transaction.deleteMany({
            where: { actorCustomerId: { in: ids } },
          });
          await prisma.account.deleteMany({ where: { customerId: { in: ids } } });
          await prisma.customer.deleteMany({ where: { id: { in: ids } } });
        }
      }
    } finally {
      if (redis) {
        await redis.quit();
      }
      await app?.close();
    }
  });

  it('POST /transactions/transfer success', async () => {
    const session = await registerAndLogin('success');
    const fromAccountId = await createAccount(session.accessToken, 'USD');
    const toAccountId = await createAccount(session.accessToken, 'EUR');
    await deposit(
      session.accessToken,
      fromAccountId,
      100,
      `dep-${randomUUID()}`,
    );

    const referenceId = `tr-success-${randomUUID()}`;
    const res = await request(httpServer())
      .post('/transactions/transfer')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({
        fromAccountId,
        toAccountId,
        amount: 25,
        referenceId,
      })
      .expect(201);

    assertSuccessEnvelope(res.body, (p) => expect(p).toContain('/transactions/transfer'));
    expect(res.body.data).toMatchObject({
      id: expect.any(String),
      type: 'TRANSFER',
      fromAccountId,
      toAccountId,
      amount: expect.any(String),
      status: 'COMPLETED',
      referenceId,
    });
  });

  it('transfer insufficient balance returns 400', async () => {
    const session = await registerAndLogin('insufficient');
    const fromAccountId = await createAccount(session.accessToken, 'USD');
    const toAccountId = await createAccount(session.accessToken, 'EUR');

    const res = await request(httpServer())
      .post('/transactions/transfer')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({
        fromAccountId,
        toAccountId,
        amount: 50,
        referenceId: `tr-insufficient-${randomUUID()}`,
      })
      .expect(400);

    assertErrorEnvelope(res.body, 400, (p) => expect(p).toContain('/transactions/transfer'));
    expect(res.body.error.message).toBe('Insufficient balance');
  });

  it('duplicate transfer in-flight returns idempotency conflict', async () => {
    const session = await registerAndLogin('idempotency');
    const fromAccountId = randomUUID();
    const toAccountId = randomUUID();
    const referenceId = `tr-dup-${randomUUID()}`;
    const key = `transactions:idempotency:${session.userId}:transfer:${referenceId}`;

    if (!redis) {
      throw new Error('Redis test client not initialized');
    }
    await redis.set(key, 'in-flight', 'EX', 60);

    try {
      const res = await request(httpServer())
        .post('/transactions/transfer')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({
          fromAccountId,
          toAccountId,
          amount: 10,
          referenceId,
        })
        .expect(409);

      assertErrorEnvelope(res.body, 409, (p) => expect(p).toContain('/transactions/transfer'));
      expect(res.body.error.message).toBe('Duplicate request in progress');
    } finally {
      await redis.del(key);
    }
  });

  it('fraud rejection returns expected user-facing message', async () => {
    const session = await registerAndLogin('fraud');
    const accountId = await createAccount(session.accessToken, 'USD');
    await deposit(
      session.accessToken,
      accountId,
      50,
      `dep-fraud-${randomUUID()}`,
    );

    const res = await request(httpServer())
      .post('/transactions/transfer')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({
        fromAccountId: accountId,
        toAccountId: accountId,
        amount: 10,
        referenceId: `tr-fraud-${randomUUID()}`,
      })
      .expect(400);

    assertErrorEnvelope(res.body, 400, (p) => expect(p).toContain('/transactions/transfer'));
    expect(res.body.error.message).toBe('You cannot transfer to the same account.');
  });
});
