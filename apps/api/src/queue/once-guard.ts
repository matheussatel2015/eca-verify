import { RedisLike } from '../redis/redis-like';

/** Ensures a transaction is processed at most once (webhook idempotency). */
export class OnceGuard {
  constructor(private readonly redis: RedisLike) {}

  acquire(transactionId: string, ttlMs: number): Promise<boolean> {
    return this.redis.setNx(`once:${transactionId}`, '1', ttlMs);
  }
}
