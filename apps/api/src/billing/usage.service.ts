import { RedisLike } from '../redis/redis-like';

const FORTY_DAYS_MS = 40 * 24 * 60 * 60 * 1000;

export function monthKey(tenantId: string, now: Date): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `usage:${tenantId}:${y}-${m}`;
}

export class UsageService {
  constructor(private readonly redis: RedisLike, private readonly nowFn: () => Date = () => new Date()) {}

  async increment(tenantId: string): Promise<number> {
    const key = monthKey(tenantId, this.nowFn());
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.pexpire(key, FORTY_DAYS_MS); // expire after the month closes
    return n;
  }

  /**
   * Atomic increment-and-check: bumps the counter first, then verifies it is
   * within `limit`. If it overshoots, the counter is rolled back via decr so a
   * losing concurrent request does not leave the usage inflated. This closes the
   * check-then-act race in the old current()+increment() flow.
   */
  async incrementAndCheck(tenantId: string, limit: number): Promise<{ allowed: boolean; used: number }> {
    const key = monthKey(tenantId, this.nowFn());
    const n = await this.redis.incr(key);
    if (n === 1) await this.redis.pexpire(key, FORTY_DAYS_MS);
    if (n > limit) {
      await this.redis.decr(key);
      return { allowed: false, used: n - 1 };
    }
    return { allowed: true, used: n };
  }

  async current(tenantId: string): Promise<number> {
    const v = await this.redis.get(monthKey(tenantId, this.nowFn()));
    return v ? Number(v) : 0;
  }
}
