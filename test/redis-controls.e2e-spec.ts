import { ConfigService } from '@nestjs/config';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';
import { CONFIG_KEYS } from '../src/config/config';

describe('Redis-backed control behavior (integration)', () => {
  const envPath = path.resolve(process.cwd(), '.env');
  const envConfig = fs.existsSync(envPath)
    ? dotenv.parse(fs.readFileSync(envPath))
    : process.env;
  const configService = new ConfigService(envConfig as Record<string, any>);
  const redisUrl =
    configService.get<string>('REDIS_URL_TEST') ??
    configService.get<string>(CONFIG_KEYS.REDIS_URL);

  let redis: Redis | null = null;
  let redisReady = false;
  let redisSkipReason = '';
  const createdRedisKeys = new Set<string>();

  beforeAll(async () => {
    if (!redisUrl) {
      redisSkipReason = 'REDIS_URL is not set in config';
      return;
    }
    redis = new Redis(redisUrl);
    try {
      const pong = await redis.ping();
      redisReady = pong === 'PONG';
      if (!redisReady) {
        redisSkipReason = `redis ping returned ${pong}`;
      }
    } catch (err) {
      redisSkipReason = `redis connection failed: ${
        err instanceof Error ? err.message : String(err)
      }`;
    }
  });

  afterEach(async () => {
    if (!redisReady || !redis || createdRedisKeys.size === 0) return;
    const keys = [...createdRedisKeys];
    createdRedisKeys.clear();
    await redis.del(...keys);
  });

  afterAll(async () => {
    if (redis) await redis.quit();
  });

  const ensureRedisReady = () => {
    if (!redisReady) {
      console.warn(`Skipping Redis assertion: ${redisSkipReason}`);
      return false;
    }
    return true;
  };

  it('keeps idempotency in-flight/done key lifecycle', async () => {
    if (!ensureRedisReady() || !redis) return;
    const key = `transactions:idempotency:u1:transfer:ref-${randomUUID()}`;
    createdRedisKeys.add(key);

    const firstSet = await redis.set(key, 'in-flight', 'EX', 180, 'NX');
    const inFlight = await redis.get(key);
    const doneSet = await redis.set(key, 'done', 'EX', 300);
    const done = await redis.get(key);

    expect(firstSet).toBe('OK');
    expect(inFlight).toBe('in-flight');
    expect(doneSet).toBe('OK');
    expect(done).toBe('done');
  });

  it('applies rate-limit TTL counter behavior', async () => {
    if (!ensureRedisReady() || !redis) return;
    const key = `transfer:rate:user:u1:${Math.floor(Date.now() / 60_000)}`;
    createdRedisKeys.add(key);

    const lua = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
end
return count
`;
    const rawCount = await redis.eval(lua, 1, key, '60');
    const count = Number(rawCount);
    const ttl = await redis.ttl(key);

    expect(count).toBe(1);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
  });
});
