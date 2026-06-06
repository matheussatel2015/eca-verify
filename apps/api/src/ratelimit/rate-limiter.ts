import { RedisLike } from '../redis/redis-like';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
}

export class RateLimiter {
  constructor(private readonly redis: RedisLike) {}

  async check(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.pexpire(key, windowMs);
    const resetMs = await this.redis.pttl(key);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), resetMs };
  }
}
