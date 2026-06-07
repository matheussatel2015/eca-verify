import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { ProofController } from './proof.controller';
import { ProofService } from './proof.service';
import { loadProofPrivateKeyPem, proofIssuer } from '../config';

@Module({
  imports: [TenantModule], // ApiKeyGuard
  controllers: [ProofController],
  providers: [
    {
      provide: ProofService,
      useFactory: () => {
        const pem = loadProofPrivateKeyPem(process.env);
        return pem ? new ProofService(pem, proofIssuer(process.env)) : null;
      },
    },
  ],
})
export class ProofModule {}
