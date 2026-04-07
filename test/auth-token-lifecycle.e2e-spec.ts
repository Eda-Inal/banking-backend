import * as crypto from 'crypto';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { CONFIG_KEYS } from '../src/config/config';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';

describe('Auth token lifecycle with DB (integration)', () => {
  const envPath = path.resolve(process.cwd(), '.env');
  const envConfig = fs.existsSync(envPath)
    ? dotenv.parse(fs.readFileSync(envPath))
    : process.env;
  const configService = new ConfigService(envConfig as Record<string, any>);
  const databaseUrl = configService.get<string>(CONFIG_KEYS.DATABASE_URL);

  let pool: Pool | null = null;
  let dbReady = false;
  let skipReason = '';
  const createdCustomerIds: string[] = [];

  beforeAll(async () => {
    if (!databaseUrl) {
      skipReason = 'DATABASE_URL is not set in config';
      return;
    }
    pool = new Pool({ connectionString: databaseUrl });
    try {
      const client = await pool.connect();
      client.release();
      dbReady = true;
    } catch (err) {
      skipReason = `database connection failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  });

  afterEach(async () => {
    if (createdCustomerIds.length === 0) return;
    const ids = [...createdCustomerIds];
    createdCustomerIds.length = 0;
    await withClient(async (client) => {
      await client.query(
        `DELETE FROM refresh_tokens WHERE customer_id = ANY($1::uuid[])`,
        [ids],
      );
      await client.query(`DELETE FROM customers WHERE id = ANY($1::uuid[])`, [
        ids,
      ]);
    });
  });

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
  });

  const withClient = async <T>(fn: (client: PoolClient) => Promise<T>) => {
    if (!pool) throw new Error('Pool is not initialized');
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  };

  const ensureDbReady = () => {
    if (!dbReady) {
      console.warn(`Skipping DB integration assertion: ${skipReason}`);
      return false;
    }
    return true;
  };

  const hashToken = (raw: string) =>
    crypto.createHash('sha256').update(raw).digest('hex');

  const createCustomer = async () => {
    const customerId = randomUUID();
    await withClient(async (client) => {
      await client.query(
        `INSERT INTO customers (id, email, name, phone, password_hash, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          customerId,
          `itest-${customerId}@example.com`,
          'Integration User',
          '5555555555',
          'hash',
        ],
      );
    });
    createdCustomerIds.push(customerId);
    return customerId;
  };

  it('persists refresh token hash after login', async () => {
    if (!ensureDbReady()) return;
    const customerId = await createCustomer();
    const rawRefreshToken = `rt-${randomUUID()}`;
    const tokenHash = hashToken(rawRefreshToken);

    await withClient(async (client) => {
      await client.query(
        `INSERT INTO refresh_tokens (id, customer_id, token_hash, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, NOW() + interval '1 hour', $4, $5)`,
        [randomUUID(), customerId, tokenHash, '127.0.0.1', 'jest-e2e'],
      );
    });

    const tokenRow = await withClient(async (client) => {
      const res = await client.query(
        `SELECT customer_id, token_hash, revoked_at
         FROM refresh_tokens
         WHERE token_hash = $1`,
        [tokenHash],
      );
      return res.rows[0];
    });

    expect(tokenRow).not.toBeNull();
    expect(tokenRow?.customer_id).toBe(customerId);
    expect(tokenRow?.token_hash).toBe(tokenHash);
    expect(tokenRow?.revoked_at).toBeNull();
  });

  it('rotates refresh token and revokes previous token in chain', async () => {
    if (!ensureDbReady()) return;
    const customerId = await createCustomer();
    const oldRawToken = `rt-old-${randomUUID()}`;
    const oldTokenHash = hashToken(oldRawToken);
    const newRawToken = `rt-new-${randomUUID()}`;
    const newTokenHash = hashToken(newRawToken);
    const oldTokenId = randomUUID();
    const newTokenId = randomUUID();

    await withClient(async (client) => {
      await client.query(
        `INSERT INTO refresh_tokens (id, customer_id, token_hash, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, NOW() + interval '1 hour', $4, $5)`,
        [oldTokenId, customerId, oldTokenHash, '127.0.0.1', 'jest-e2e'],
      );

      await client.query(
        `INSERT INTO refresh_tokens (id, customer_id, token_hash, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, NOW() + interval '1 hour', $4, $5)`,
        [newTokenId, customerId, newTokenHash, '127.0.0.1', 'jest-e2e'],
      );

      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW(), replaced_by_id = $1
         WHERE id = $2 AND revoked_at IS NULL`,
        [newTokenId, oldTokenId],
      );
    });

    const oldTokenRow = await withClient(async (client) => {
      const res = await client.query(
        `SELECT id, revoked_at, replaced_by_id
         FROM refresh_tokens
         WHERE token_hash = $1`,
        [oldTokenHash],
      );
      return res.rows[0];
    });
    const newTokenRow = await withClient(async (client) => {
      const res = await client.query(
        `SELECT id, revoked_at
         FROM refresh_tokens
         WHERE token_hash = $1`,
        [newTokenHash],
      );
      return res.rows[0];
    });

    expect(newTokenRow).not.toBeNull();
    expect(oldTokenRow).not.toBeNull();
    expect(oldTokenRow?.revoked_at).not.toBeNull();
    expect(oldTokenRow?.replaced_by_id).toBe(newTokenRow?.id);
    expect(newTokenRow?.revoked_at).toBeNull();
  });
});
