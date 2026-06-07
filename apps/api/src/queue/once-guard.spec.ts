import { OnceGuard } from './once-guard';
import { RedisLike } from '../redis/redis-like';

class FakeRedis implements RedisLike {
  keys = new Set<string>();
  async incr() { return 1; }
  async pexpire() {}
  async pttl() { return 0; }
  async setNx(key: string) { if (this.keys.has(key)) return false; this.keys.add(key); return true; }
  async get() { return null; }
}

test('acquire succeeds the first time and fails the second', async () => {
  const guard = new OnceGuard(new FakeRedis());
  expect(await guard.acquire('tx1', 600000)).toBe(true);
  expect(await guard.acquire('tx1', 600000)).toBe(false);
});
