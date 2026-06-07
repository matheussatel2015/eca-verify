import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { ApiKeyGuard } from '../tenant/api-key.guard';
import { ConsentService } from './consent.service';

@Controller('consent')
@UseGuards(ApiKeyGuard)
export class ConsentController {
  constructor(private readonly consent: ConsentService) {}

  // Data-subject access: the tenant retrieves the consent trail for one of ITS users.
  // RLS scopes the read; a tenant can never see another tenant's consent records.
  @Get(':user_hash')
  async byUser(@Req() req: any, @Param('user_hash') userHash: string) {
    const records = await this.consent.listByUserHash(req.tenant.id, userHash);
    return {
      user_hash: userHash,
      consents: records.map((r) => ({
        id: r.id,
        policy_version: r.policyVersion,
        scope: r.scope,
        masked_ip: r.maskedIp,
        created_at: r.createdAt,
      })),
      // Erasure proof is keyed by transaction_id (see discard_log); retrieve per-transaction
      // via the audit/erasure trail. Kept separate so consent and deletion proofs stay distinct.
      erasure_proof_note: 'discard_log holds physical-deletion events per transaction_id (RLS-scoped)',
    };
  }
}
