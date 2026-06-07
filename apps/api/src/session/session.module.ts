import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VerificationSession } from './session.entity';
import { SessionController } from './session.controller';
import { TenantModule } from '../tenant/tenant.module';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [TypeOrmModule.forFeature([VerificationSession]), TenantModule, BillingModule],
  controllers: [SessionController],
})
export class SessionModule {}
