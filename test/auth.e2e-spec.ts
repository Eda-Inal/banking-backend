import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Server } from 'http';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createE2eApplication } from './helpers/create-e2e-app';
import { assertErrorEnvelope, assertSuccessEnvelope } from './helpers/http-contract';

function normalizeSetCookie(header: string | string[] | undefined): string[] {
  if (header == null) return [];
  return Array.isArray(header) ? header : [header];
}

describe('Auth (e2e)', () => {
  let app: INestApplication | undefined;
  let prisma: PrismaService | undefined;

  function httpServer(): Server {
    if (!app) {
      throw new Error('E2E application not initialized');
    }
    return app.getHttpServer();
  }

  const password = 'E2eSecure1';
  const email = `e2e-auth-${randomUUID()}@example.com`.toLowerCase();

  jest.setTimeout(60_000);

  beforeAll(async () => {
    app = await createE2eApplication();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    try {
      if (prisma) {
        const customer = await prisma.customer.findUnique({ where: { email } });
        if (customer) {
          await prisma.auditLog.deleteMany({ where: { customerId: customer.id } });
          await prisma.refreshToken.deleteMany({ where: { customerId: customer.id } });
          await prisma.customer.delete({ where: { id: customer.id } });
        }
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  describe('POST /auth/register', () => {
    it('registers a new customer and returns the success contract', async () => {
      const res = await request(httpServer())
        .post('/auth/register')
        .send({
          email,
          password,
          name: 'E2E User',
          phone: '5551234567',
        })
        .expect(201);

      assertSuccessEnvelope(res.body, (p) => expect(p).toContain('/auth/register'));
      expect(res.body.data).toEqual({
        message: 'Customer registered successfully',
      });
    });

    it('returns 409 when the email already exists', async () => {
      const res = await request(httpServer())
        .post('/auth/register')
        .send({
          email,
          password,
          name: 'Duplicate',
          phone: '5559876543',
        })
        .expect(409);

      assertErrorEnvelope(res.body, 409, (p) => expect(p).toContain('/auth/register'));
      expect(res.body.error.message).toBe('Customer already exists');
    });
  });

  describe('POST /auth/login', () => {
    it('returns 401 for a valid email with wrong password', async () => {
      const res = await request(httpServer())
        .post('/auth/login')
        .send({ email, password: 'WrongPass1' })
        .expect(401);

      assertErrorEnvelope(res.body, 401, (p) => expect(p).toContain('/auth/login'));
      expect(res.body.error.message).toBe('Invalid credentials');
    });

    it('returns 401 for an unknown email', async () => {
      const res = await request(httpServer())
        .post('/auth/login')
        .send({ email: 'nobody-' + randomUUID() + '@example.com', password })
        .expect(401);

      assertErrorEnvelope(res.body, 401, (p) => expect(p).toContain('/auth/login'));
      expect(res.body.error.message).toBe('Invalid credentials');
    });

    it('sets httpOnly refresh cookie and omits refresh token from JSON body on success', async () => {
      const res = await request(httpServer())
        .post('/auth/login')
        .send({ email, password })
        .expect(201);

      assertSuccessEnvelope(res.body, (p) => expect(p).toContain('/auth/login'));

      const cookies = normalizeSetCookie(res.headers['set-cookie']);
      expect(cookies.length).toBeGreaterThan(0);
      const refreshCookie = cookies.find((c) => c.startsWith('refreshToken='));
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toMatch(/HttpOnly/i);
      expect(refreshCookie).toMatch(/SameSite=Strict/i);

      expect(res.body.data).not.toHaveProperty('refreshToken');
      expect(res.body.data).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: expect.any(Number),
        accessToken: expect.any(String),
        user: {
          id: expect.any(String),
          email,
          name: 'E2E User',
        },
      });
    });
  });

  describe('POST /auth/refresh', () => {
    it('returns 401 when the refresh cookie is missing', async () => {
      const res = await request(httpServer()).post('/auth/refresh').expect(401);

      assertErrorEnvelope(res.body, 401, (p) => expect(p).toContain('/auth/refresh'));
      expect(res.body.error.message).toBe('Invalid refresh token');
    });

    it('returns 401 when the refresh cookie does not match a stored token', async () => {
      const res = await request(httpServer())
        .post('/auth/refresh')
        .set('Cookie', ['refreshToken=deadbeefnotavalidtoken'])
        .expect(401);

      assertErrorEnvelope(res.body, 401, (p) => expect(p).toContain('/auth/refresh'));
      expect(res.body.error.message).toBe('Invalid refresh token');
    });

    it('returns a new access token and rotated refresh cookie when the cookie is valid', async () => {
      const agent = request.agent(httpServer());

      const loginRes = await agent.post('/auth/login').send({ email, password }).expect(201);
      assertSuccessEnvelope(loginRes.body);

      const refreshRes = await agent.post('/auth/refresh').expect(201);
      assertSuccessEnvelope(refreshRes.body, (p) => expect(p).toContain('/auth/refresh'));

      expect(refreshRes.body.data).toMatchObject({
        tokenType: 'Bearer',
        expiresIn: expect.any(Number),
        accessToken: expect.any(String),
        user: {
          id: expect.any(String),
          email,
          name: 'E2E User',
        },
      });

      const refreshCookies = normalizeSetCookie(refreshRes.headers['set-cookie']);
      expect(refreshCookies.some((c) => c.startsWith('refreshToken='))).toBe(true);
      expect(refreshRes.body.data).not.toHaveProperty('refreshToken');
    });
  });

  describe('POST /auth/logout', () => {
    it('returns success when no refresh cookie is present', async () => {
      const res = await request(httpServer()).post('/auth/logout').expect(201);

      assertSuccessEnvelope(res.body, (p) => expect(p).toContain('/auth/logout'));
      expect(res.body.data).toEqual({ message: 'Logged out' });
    });

    it('revokes the session, clears the cookie, and rejects further refresh with the old cookie', async () => {
      const agent = request.agent(httpServer());
      await agent.post('/auth/login').send({ email, password }).expect(201);

      const logoutRes = await agent.post('/auth/logout').expect(201);
      assertSuccessEnvelope(logoutRes.body, (p) => expect(p).toContain('/auth/logout'));
      expect(logoutRes.body.data).toEqual({ message: 'Logged out' });

      const logoutCookies = normalizeSetCookie(logoutRes.headers['set-cookie']);
      expect(logoutCookies.length).toBeGreaterThan(0);
      const cleared = logoutCookies.find((c) => c.startsWith('refreshToken='));
      expect(cleared).toBeDefined();
      expect(cleared).toMatch(/Max-Age=0|expires=Thu, 01 Jan 1970/i);

      const refreshAfter = await agent.post('/auth/refresh').expect(401);
      assertErrorEnvelope(refreshAfter.body, 401);
      expect(refreshAfter.body.error.message).toBe('Invalid refresh token');
    });
  });
});
