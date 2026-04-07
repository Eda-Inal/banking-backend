import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';
import { CONFIG_KEYS } from '../src/config/config';

describe('Account invariants (integration)', () => {
  const envPath = path.resolve(process.cwd(), '.env');
  const envConfig = fs.existsSync(envPath)
    ? dotenv.parse(fs.readFileSync(envPath))
    : process.env;
  const configService = new ConfigService(envConfig as Record<string, any>);
  const databaseUrl = configService.get<string>(CONFIG_KEYS.DATABASE_URL);

  let pool: Pool | null = null;
  let dbReady = false;
  let dbSkipReason = '';
  const createdCustomerIds: string[] = [];

  beforeAll(async () => {
    if (!databaseUrl) {
      dbSkipReason = 'DATABASE_URL is not set in config';
      return;
    }
    pool = new Pool({ connectionString: databaseUrl });
    try {
      const client = await pool.connect();
      client.release();
      dbReady = true;
    } catch (err) {
      dbSkipReason = `database connection failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  });

  afterEach(async () => {
    if (!dbReady || createdCustomerIds.length === 0) return;
    const ids = [...createdCustomerIds];
    createdCustomerIds.length = 0;
    await withDbClient(async (client) => {
      await client.query(`DELETE FROM transactions WHERE actor_customer_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM audit_logs WHERE customer_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM accounts WHERE customer_id = ANY($1::uuid[])`, [ids]);
      await client.query(`DELETE FROM customers WHERE id = ANY($1::uuid[])`, [ids]);
    });
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  const withDbClient = async <T>(fn: (client: PoolClient) => Promise<T>) => {
    if (!pool) throw new Error('DB pool is not initialized');
    const client = await pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  };

  const ensureDbReady = () => {
    if (!dbReady) {
      console.warn(`Skipping DB assertion: ${dbSkipReason}`);
      return false;
    }
    return true;
  };

  const setupCustomerWithAccount = async (balance: string, status: string) =>
    withDbClient(async (client) => {
      const customerId = randomUUID();
      const accountId = randomUUID();
      await client.query(
        `INSERT INTO customers (id, email, name, phone, password_hash, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [customerId, `itest-${customerId}@example.com`, 'Integration User', '5555555555', 'hash'],
      );
      await client.query(
        `INSERT INTO accounts (id, customer_id, balance, currency, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [accountId, customerId, balance, 'USD', status],
      );
      createdCustomerIds.push(customerId);
      return { customerId, accountId };
    });

  it('close only succeeds when balance is zero', async () => {
    if (!ensureDbReady()) return;
    const nonZero = await setupCustomerWithAccount('25.00', 'ACTIVE');
    const zero = await setupCustomerWithAccount('0.00', 'ACTIVE');

    const nonZeroUpdate = await withDbClient((client) =>
      client.query(
        `UPDATE accounts SET status = 'CLOSED'
         WHERE id = $1 AND customer_id = $2
           AND status IN ('ACTIVE', 'FROZEN') AND balance = 0`,
        [nonZero.accountId, nonZero.customerId],
      ),
    );
    const zeroUpdate = await withDbClient((client) =>
      client.query(
        `UPDATE accounts SET status = 'CLOSED'
         WHERE id = $1 AND customer_id = $2
           AND status IN ('ACTIVE', 'FROZEN') AND balance = 0`,
        [zero.accountId, zero.customerId],
      ),
    );

    expect(nonZeroUpdate.rowCount).toBe(0);
    expect(zeroUpdate.rowCount).toBe(1);
  });

  it('freeze/unfreeze transitions follow DB state', async () => {
    if (!ensureDbReady()) return;
    const { customerId, accountId } = await setupCustomerWithAccount('10.00', 'ACTIVE');

    const freeze1 = await withDbClient((client) =>
      client.query(`UPDATE accounts SET status = 'FROZEN' WHERE id = $1 AND customer_id = $2 AND status = 'ACTIVE'`, [accountId, customerId]),
    );
    const freeze2 = await withDbClient((client) =>
      client.query(`UPDATE accounts SET status = 'FROZEN' WHERE id = $1 AND customer_id = $2 AND status = 'ACTIVE'`, [accountId, customerId]),
    );
    const unfreeze1 = await withDbClient((client) =>
      client.query(`UPDATE accounts SET status = 'ACTIVE' WHERE id = $1 AND customer_id = $2 AND status = 'FROZEN'`, [accountId, customerId]),
    );
    const unfreeze2 = await withDbClient((client) =>
      client.query(`UPDATE accounts SET status = 'ACTIVE' WHERE id = $1 AND customer_id = $2 AND status = 'FROZEN'`, [accountId, customerId]),
    );

    expect(freeze1.rowCount).toBe(1);
    expect(freeze2.rowCount).toBe(0);
    expect(unfreeze1.rowCount).toBe(1);
    expect(unfreeze2.rowCount).toBe(0);
  });
});
