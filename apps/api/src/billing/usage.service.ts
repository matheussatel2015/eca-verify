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

  async current(tenantId: string): Promise<number> {
    const v = await this.redis.get(monthKey(tenantId, this.nowFn()));
    return v ? Number(v) : 0;
  }
}
