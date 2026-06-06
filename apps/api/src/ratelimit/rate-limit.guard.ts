import { CanActivate, ExecutionContext, Injectable, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { createHash } from 'crypto';
import { RateLimiter } from './rate-limiter';
import { extractBearer, hashApiKey } from '../tenant/api-key.guard';

export const RATE_LIMITER = Symbol('RATE_LIMITER');

/** Bucket key per api-key-hash per calendar minute. */
export function rateLimitKey(apiKeyHash: string, minuteIso: string): string {
  return `rl:${apiKeyHash}:${minuteIso}`;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(@Inject(RATE_LIMITER) private readonly limiter: RateLimiter) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = extractBearer(req.headers['authorization']) ?? 'anon';
    const hash = token === 'anon' ? createHash('sha256').update(req.ip ?? 'unknown').digest('hex') : hashApiKey(token);
    const minuteIso = new Date().toISOString().slice(0, 16);
    const limit = Number(process.env.RATE_LIMIT_PER_MIN ?? 60);
    const result = await this.limiter.check(rateLimitKey(hash, minuteIso), limit, 60000);
    if (!result.allowed) {
      throw new HttpException('rate limit exceeded', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
