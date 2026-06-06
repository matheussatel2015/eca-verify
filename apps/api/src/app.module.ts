import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant/tenant.entity';
import { ApiKey } from './tenant/api-key.entity';
import { VerificationSession } from './session/session.entity';
import { AuditLog } from './audit/audit-log.entity';
import { SessionModule } from './session/session.module';
import { VerificationModule } from './verification/verification.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [Tenant, ApiKey, VerificationSession, AuditLog],
      synchronize: false,
    }),
    SessionModule,
    VerificationModule,
  ],
})
export class AppModule {}
