import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant/tenant.entity';
import { VerificationSession } from './session/session.entity';
import { AuditLog } from './audit/audit-log.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      entities: [Tenant, VerificationSession, AuditLog],
      synchronize: false,
    }),
  ],
})
export class AppModule {}
