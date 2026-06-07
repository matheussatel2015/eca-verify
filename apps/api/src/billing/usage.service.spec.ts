import { UsageService, monthKey } from './usage.service';
import { RedisLike } from '../redis/redis-like';

class FakeRedis implements RedisLike {
  store = new Map<string, number>();
  expired = new Map<string, number>();
  async incr(key: string) { const n = (this.store.get(key) ?? 0) + 1; this.store.set(key, n); return n; }
  async decr(key: string) { const n = (this.store.get(key) ?? 0) - 1; this.store.set(key, n); return n; }
  async pexpire(key: string, ms: number) { this.expired.set(key, ms); }
  async pttl() { return -1; }
  async setNx() { return true; }
  async get(key: string) { const v = this.store.get(key); return v === undefined ? null : String(v); }
}

const FIXED = new Date('2026-06-15T00:00:00Z');

test('monthKey is per tenant per UTC month', () => {
  expect(monthKey('ten1', FIXED)).toBe('usage:ten1:2026-06');
});

test('increment counts up and sets a TTL only on the first hit', async () => {
  const redis = new FakeRedis();
  const usage = new UsageService(redis, () => FIXED);
  expect(await usage.increment('ten1')).toBe(1);
  expect(await usage.increment('ten1')).toBe(2);
  expect(redis.expired.size).toBe(1); // TTL set once
});

test('current reads the counter, defaulting to 0', async () => {
  const redis = new FakeRedis();
  const usage = new UsageService(redis, () => FIXED);
  expect(await usage.current('ten1')).toBe(0);
  await usage.increment('ten1');
  expect(await usage.current('ten1')).toBe(1);
});

test('incrementAndCheck allows up to the limit then blocks and rolls back at the boundary', async () => {
  const redis = new FakeRedis();
  const usage = new UsageService(redis, () => FIXED);
  const LIMIT = 3;
  // the (1..limit)th calls are allowed
  for (let i = 1; i <= LIMIT; i++) {
    const r = await usage.incrementAndCheck('ten1', LIMIT);
    expect(r).toEqual({ allowed: true, used: i });
  }
  // the (limit+1)th call is blocked and the counter is rolled back
  const blocked = await usage.incrementAndCheck('ten1', LIMIT);
  expect(blocked).toEqual({ allowed: false, used: LIMIT });
  expect(await usage.current('ten1')).toBe(LIMIT); // stays at the limit, not limit+1
});

test('incrementAndCheck sets the TTL only on the first hit', async () => {
  const redis = new FakeRedis();
  const usage = new UsageService(redis, () => FIXED);
  await usage.incrementAndCheck('ten1', 5);
  await usage.incrementAndCheck('ten1', 5);
  expect(redis.expired.size).toBe(1);
});
