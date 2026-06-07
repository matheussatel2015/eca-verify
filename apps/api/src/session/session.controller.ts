import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID, randomBytes } from 'crypto';
import { ApiKeyGuard } from '../tenant/api-key.guard';
import { assertNoPii } from './pii-guard.util';
import { VerificationSession } from './session.entity';
import { withTenantScope } from '../tenant/tenant-scope';
import { BillingService } from '../billing/billing.service';
import { UsageService } from '../billing/usage.service';

@Controller('sessions')
@UseGuards(ApiKeyGuard)
export class SessionController {
  constructor(
    @InjectRepository(VerificationSession) private readonly sessions: Repository<VerificationSession>,
    private readonly billing: BillingService,
    private readonly usage: UsageService,
  ) {}

  @Post()
  async create(@Body() body: Record<string, unknown>, @Req() req: any) {
    try {
      assertNoPii(body);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
    const userHash = body['user_hash'];
    if (typeof userHash !== 'string' || !userHash) {
      throw new BadRequestException('user_hash is required');
    }
    const tenantId = req.tenant.id as string;
    await this.billing.assertWithinQuota(tenantId); // throws 402 when over the monthly quota
    const session: VerificationSession = {
      id: randomUUID(),
      tenantId,
      userHash,
      sessionToken: randomBytes(24).toString('hex'),
      createdAt: new Date(),
    };
    await this.sessions.manager.transaction(async (mgr) => {
      await withTenantScope({ query: (sql, params) => mgr.query(sql, params) }, tenantId, async () => {
        await mgr.save(VerificationSession, session);
      });
    });
    await this.usage.increment(tenantId);
    return {
      session_token: session.sessionToken,
      plugin_url: `https://verify.local/plugin?session=${session.sessionToken}`,
    };
  }
}
