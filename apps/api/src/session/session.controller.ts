import { BadRequestException, Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID, randomBytes } from 'crypto';
import { ApiKeyGuard } from '../tenant/api-key.guard';
import { assertNoPii } from './pii-guard.util';
import { VerificationSession } from './session.entity';
import { withTenantScope } from '../tenant/tenant-scope';
import { BillingService } from '../billing/billing.service';
import { buildConsentRecord } from '../consent/consent-record.builder';
import { ConsentService } from '../consent/consent.service';

@Controller('sessions')
@UseGuards(ApiKeyGuard)
export class SessionController {
  constructor(
    @InjectRepository(VerificationSession) private readonly sessions: Repository<VerificationSession>,
    private readonly billing: BillingService,
    private readonly consent: ConsentService,
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
    const policyVersion = body['policy_version'];
    if (typeof policyVersion !== 'string' || !policyVersion.trim()) {
      throw new BadRequestException('policy_version is required');
    }
    if (body['consent'] !== true) {
      throw new BadRequestException('explicit consent is required to open a verification session');
    }
    const tenantId = req.tenant.id as string;
    await this.billing.consumeQuota(tenantId); // atomically consumes quota; throws 402 when over the monthly quota
    const session: VerificationSession = {
      id: randomUUID(),
      tenantId,
      userHash,
      sessionToken: randomBytes(24).toString('hex'),
      createdAt: new Date(),
    };
    const rawIp = (req.ip as string) ?? (req.headers?.['x-forwarded-for'] as string) ?? '0.0.0.0';
    const consentRecord = buildConsentRecord({
      id: randomUUID(), tenantId, userHash, policyVersion, scope: 'age_verification', rawIp, now: new Date(),
    });
    await this.sessions.manager.transaction(async (mgr) => {
      await withTenantScope({ query: (sql, params) => mgr.query(sql, params) }, tenantId, async () => {
        await mgr.save(VerificationSession, session);
        await this.consent.saveWith(mgr, consentRecord as any);
      });
    });
    return {
      session_token: session.sessionToken,
      plugin_url: `https://verify.local/plugin?session=${session.sessionToken}`,
    };
  }
}
