import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VerificationSession } from '../session/session.entity';
import { Tenant } from '../tenant/tenant.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { AuditService } from '../audit/audit.service';
import { WebhookService } from '../webhook/webhook.service';
import { MockAgeProvider } from './mock-age-provider';
import { loadDecisionConfig, encryptionKey } from '../config';

@Module({
  imports: [TypeOrmModule.forFeature([VerificationSession, Tenant, AuditLog])],
  controllers: [VerificationController],
  providers: [
    AuditService,
    { provide: WebhookService, useFactory: () => new WebhookService() },
    {
      provide: VerificationService,
      inject: [AuditService, WebhookService],
      useFactory: (audit: AuditService, webhook: WebhookService) =>
        new VerificationService(
          new MockAgeProvider({ estimatedAge: 30, livenessScore: 0.95 }),
          audit,
          webhook,
          loadDecisionConfig(process.env),
          encryptionKey(process.env),
        ),
    },
  ],
})
export class VerificationModule {}
