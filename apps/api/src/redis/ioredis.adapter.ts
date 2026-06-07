import Redis from 'ioredis';
import { RedisLike } from './redis-like';

export class IoRedisAdapter implements RedisLike {
  constructor(private readonly client: Redis) {}

  incr(key: string): Promise<number> {
    return this.client.incr(key);
  }
  async pexpire(key: string, ms: number): Promise<void> {
    await this.client.pexpire(key, ms);
  }
  pttl(key: string): Promise<number> {
    return this.client.pttl(key);
  }
  async setNx(key: string, value: string, ttlMs: number): Promise<boolean> {
    const res = await this.client.set(key, value, 'PX', ttlMs, 'NX');
    return res === 'OK';
  }
  get(key: string): Promise<string | null> {
    return this.client.get(key);
  }
}
