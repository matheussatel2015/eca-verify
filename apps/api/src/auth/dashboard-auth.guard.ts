import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { extractBearer } from '../tenant/api-key.guard';
import { ApiKeyService } from '../tenant/api-key.service';
import { Tenant } from '../tenant/tenant.entity';
import { DashboardAuthService, DashboardClaims } from './dashboard-auth.service';

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** A JWT has exactly three non-empty base64url dot-separated parts; API keys (sk_...) do not. */
export function looksLikeJwt(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => BASE64URL.test(p));
}

@Injectable()
export class DashboardAuthGuard implements CanActivate {
  constructor(
    private readonly auth: DashboardAuthService,
    private readonly apiKeys: ApiKeyService,
    @InjectRepository(Tenant) private readonly tenants: Repository<Tenant>,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const token = extractBearer(req.headers['authorization']);
    if (!token) throw new UnauthorizedException('missing credentials');

    if (looksLikeJwt(token)) {
      let claims: DashboardClaims;
      try {
        claims = await this.auth.verifyToken(token);
      } catch {
        throw new UnauthorizedException('invalid session token');
      }
      const tenant = await this.tenants.findOne({ where: { id: claims.tenantId } });
      if (!tenant) throw new UnauthorizedException('tenant not found');
      req.tenant = tenant;
      req.dashboardUser = { id: claims.userId, email: claims.email };
      return true;
    }

    const tenant = await this.apiKeys.resolveTenant(token);
    if (!tenant) throw new UnauthorizedException('invalid api key');
    req.tenant = tenant;
    return true;
  }
}
