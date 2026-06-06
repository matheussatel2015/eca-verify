import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHash } from 'crypto';
import { ApiKeyService } from './api-key.service';

export function extractBearer(header?: string): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length);
}

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeyService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = extractBearer(req.headers['authorization']);
    if (!token) throw new UnauthorizedException('missing api key');
    const tenant = await this.apiKeys.resolveTenant(token);
    if (!tenant) throw new UnauthorizedException('invalid api key');
    req.tenant = tenant;
    return true;
  }
}
