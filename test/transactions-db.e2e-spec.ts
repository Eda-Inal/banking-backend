import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { CONFIG_KEYS } from '../src/config/config';

describe('Transactions DB correctness (integration)', () => {
  const envPath = path.resolve(process.cwd(), '.env');
  const envConfig = fs.existsSync(envPath)
    ? dotenv.parse(fs.readFileSync(envPath))
    : process.env;
  const configService = new ConfigService(envConfig as Record<string, any>);
  const databaseUrl = configService.get<string>(CONFIG_KEYS.DATABASE_URL);
  let pool: Pool | null = null;
  let dbReady = false;
  let skipReason = '';

  beforeAll(async () => {
    if (!databaseUrl) {
      skipReason = 'DATABASE_URL is not set';
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

  const setupCustomerWithAccounts = async () =>
    withClient(async (client) => {
      const customerId = randomUUID();
      const fromAccountId = randomUUID();
      const toAccountId = randomUUID();

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

      await client.query(
        `INSERT INTO accounts (id, customer_id, balance, currency, status)
         VALUES ($1, $2, $3, $4, $5),
                ($6, $2, $7, $8, $9)`,
        [
          fromAccountId,
          customerId,
          '100.00',
          'USD',
          'ACTIVE',
          toAccountId,
          '10.00',
          'EUR',
          'ACTIVE',
        ],
      );

      return { customerId, fromAccountId, toAccountId };
    });

  const cleanupByCustomer = async (customerId: string) =>
    withClient(async (client) => {
      await client.query(`DELETE FROM events WHERE payload->>'actorId' = $1`, [
        customerId,
      ]);
      await client.query(`DELETE FROM transactions WHERE actor_customer_id = $1`, [
        customerId,
      ]);
      await client.query(`DELETE FROM audit_logs WHERE customer_id = $1`, [
        customerId,
      ]);
      await client.query(`DELETE FROM refresh_tokens WHERE customer_id = $1`, [
        customerId,
      ]);
      await client.query(`DELETE FROM accounts WHERE customer_id = $1`, [customerId]);
      await client.query(`DELETE FROM customers WHERE id = $1`, [customerId]);
    });

  it('keeps transfer atomicity (rollback reverts debit and credit)', async () => {
    if (!ensureDbReady()) return;
    const { customerId, fromAccountId, toAccountId } =
      await setupCustomerWithAccounts();

    try {
      await withClient(async (client) => {
        await client.query('BEGIN');
        try {
          await client.query(
            `UPDATE accounts SET balance = balance - 20
             WHERE id = $1`,
            [fromAccountId],
          );
          await client.query(
            `UPDATE accounts SET balance = balance + 20
             WHERE id = $1`,
            [toAccountId],
          );
          throw new Error('force rollback');
        } catch (err) {
          await client.query('ROLLBACK');
          if (!(err instanceof Error) || err.message !== 'force rollback') {
            throw err;
          }
        }
      });

      const balances = await withClient(async (client) =>
        client.query(
          `SELECT id, balance::text AS balance
           FROM accounts
           WHERE id IN ($1, $2)
           ORDER BY id`,
          [fromAccountId, toAccountId],
        ),
      );
      const balanceMap = new Map(
        balances.rows.map((r) => [r.id, r.balance as string]),
      );

      expect(balanceMap.get(fromAccountId)).toBe('100.00');
      expect(balanceMap.get(toAccountId)).toBe('10.00');
    } finally {
      await cleanupByCustomer(customerId);
    }
  });

  it('applies withdraw/deposit balance updates correctly', async () => {
    if (!ensureDbReady()) return;
    const { customerId, fromAccountId, toAccountId } =
      await setupCustomerWithAccounts();

    try {
      await withClient(async (client) => {
        await client.query(
          `UPDATE accounts SET balance = balance - 25
           WHERE id = $1`,
          [fromAccountId],
        );
        await client.query(
          `UPDATE accounts SET balance = balance + 40
           WHERE id = $1`,
          [toAccountId],
        );
      });

      const balances = await withClient(async (client) =>
        client.query(
          `SELECT id, balance::text AS balance
           FROM accounts
           WHERE id IN ($1, $2)
           ORDER BY id`,
          [fromAccountId, toAccountId],
        ),
      );
      const balanceMap = new Map(
        balances.rows.map((r) => [r.id, r.balance as string]),
      );

      expect(balanceMap.get(fromAccountId)).toBe('75.00');
      expect(balanceMap.get(toAccountId)).toBe('50.00');
    } finally {
      await cleanupByCustomer(customerId);
    }
  });

  it('enforces idempotency via unique actor/type/reference_id constraint', async () => {
    if (!ensureDbReady()) return;
    const { customerId, fromAccountId, toAccountId } =
      await setupCustomerWithAccounts();
    const referenceId = `ref-${randomUUID()}`;

    try {
      await withClient(async (client) => {
        await client.query(
          `INSERT INTO transactions
             (id, type, actor_customer_id, from_account, to_account, amount, status, reference_id)
           VALUES
             ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            randomUUID(),
            'TRANSFER',
            customerId,
            fromAccountId,
            toAccountId,
            '5.00',
            'COMPLETED',
            referenceId,
          ],
        );
      });

      await expect(
        withClient(async (client) =>
          client.query(
            `INSERT INTO transactions
               (id, type, actor_customer_id, from_account, to_account, amount, status, reference_id)
             VALUES
               ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [
              randomUUID(),
              'TRANSFER',
              customerId,
              fromAccountId,
              toAccountId,
              '7.00',
              'PENDING',
              referenceId,
            ],
          ),
        ),
      ).rejects.toMatchObject({ code: '23505' });
    } finally {
      await cleanupByCustomer(customerId);
    }
  });
});
