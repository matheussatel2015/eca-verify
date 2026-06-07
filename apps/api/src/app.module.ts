import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant/tenant.entity';
import { ApiKey } from './tenant/api-key.entity';
import { VerificationSession } from './session/session.entity';
import { DocumentSession } from './session/document-session.entity';
import { AuditLog } from './audit/audit-log.entity';
import { VerificationRecord } from './verification/verification-record.entity';
import { SessionModule } from './session/session.module';
import { VerificationModule } from './verification/verification.module';
import { TenantModule } from './tenant/tenant.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { BillingModule } from './billing/billing.module';
import { HealthModule } from './health/health.module';
import { ProofModule } from './proof/proof.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [Tenant, ApiKey, VerificationSession, DocumentSession, AuditLog, VerificationRecord],
      synchronize: false,
    }),
    SessionModule,
    VerificationModule,
    TenantModule,
    DashboardModule,
    BillingModule,
    HealthModule,
    ProofModule,
  ],
})
export class AppModule {}
