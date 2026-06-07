import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { ProofController } from './proof.controller';
import { ProofService } from './proof.service';
import { loadProofPrivateKeyPem, proofIssuer } from '../config';
import { PROOF_SERVICE } from './proof.token';

@Module({
  imports: [TenantModule], // ApiKeyGuard
  controllers: [ProofController],
  providers: [
    {
      provide: PROOF_SERVICE,
      inject: [],
      useFactory: () => {
        const pem = loadProofPrivateKeyPem(process.env);
        return pem ? new ProofService(pem, proofIssuer(process.env)) : null;
      },
    },
  ],
})
export class ProofModule {}
