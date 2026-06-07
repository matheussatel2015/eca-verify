import { Controller, Get, NotFoundException, Optional, Param, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ApiKeyGuard } from '../tenant/api-key.guard';
import { runScoped } from '../tenant/tenant-scope';
import { VerificationRecord } from '../verification/verification-record.entity';
import { ProofService } from './proof.service';

@Controller()
export class ProofController {
  constructor(
    private readonly dataSource: DataSource,
    @Optional() private readonly proof: ProofService | null,
  ) {}

  // Public JWKS so anyone (tenant, auditor, ANPD) can verify a proof without a shared secret.
  @Get('.well-known/jwks.json')
  async jwks() {
    if (!this.proof) throw new ServiceUnavailableException('proof signing not configured');
    return { keys: [await this.proof.publicJwk()] };
  }

  // Return the stored signed proof for one of the caller's own transactions (RLS-scoped).
  @Get('verifications/:id/proof')
  @UseGuards(ApiKeyGuard)
  async getProof(@Req() req: any, @Param('id') id: string) {
    const rec = await runScoped(this.dataSource, req.tenant.id, (mgr) =>
      mgr.findOne(VerificationRecord, { where: { id } }),
    );
    if (!rec) throw new NotFoundException('verification not found');
    if (!rec.proofJwt) throw new NotFoundException('no proof available for this transaction');
    return { transaction_id: rec.id, proof: rec.proofJwt };
  }
}
