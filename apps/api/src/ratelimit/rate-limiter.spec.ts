import { RateLimiter } from './rate-limiter';
import { RedisLike } from '../redis/redis-like';

class FakeRedis implements RedisLike {
  store = new Map<string, number>();
  async incr(key: string) { const n = (this.store.get(key) ?? 0) + 1; this.store.set(key, n); return n; }
  async pexpire() {}
  async pttl() { return 60000; }
  async setNx() { return true; }
}

test('allows requests up to the limit', async () => {
  const limiter = new RateLimiter(new FakeRedis());
  for (let i = 1; i <= 3; i++) {
    const r = await limiter.check('k', 3, 60000);
    expect(r.allowed).toBe(true);
  }
});

test('blocks the request past the limit and reports remaining 0', async () => {
  const limiter = new RateLimiter(new FakeRedis());
  await limiter.check('k', 2, 60000);
  await limiter.check('k', 2, 60000);
  const third = await limiter.check('k', 2, 60000);
  expect(third.allowed).toBe(false);
  expect(third.remaining).toBe(0);
});

test('sets the window ttl only on the first hit', async () => {
  const redis = new FakeRedis();
  const spy = jest.spyOn(redis, 'pexpire');
  const limiter = new RateLimiter(redis);
  await limiter.check('k', 5, 60000);
  await limiter.check('k', 5, 60000);
  expect(spy).toHaveBeenCalledTimes(1);
});
