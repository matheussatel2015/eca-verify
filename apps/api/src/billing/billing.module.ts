import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Tenant } from '../tenant/tenant.entity';
import { TenantModule } from '../tenant/tenant.module';
import { BillingService } from './billing.service';
import { BillingController } from './billing.controller';
import { UsageService } from './usage.service';
import { IoRedisAdapter } from '../redis/ioredis.adapter';
import { PAYMENT_PROVIDER } from './payment/payment.port';
import { buildPaymentProvider } from './payment/payment-factory';
import { loadPaymentConfig } from '../config';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant]), TenantModule],
  controllers: [BillingController],
  providers: [
    {
      provide: UsageService,
      useFactory: () =>
        new UsageService(new IoRedisAdapter(new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379'))),
    },
    { provide: PAYMENT_PROVIDER, useFactory: () => buildPaymentProvider(loadPaymentConfig(process.env), process.env) },
    BillingService,
  ],
  exports: [BillingService, UsageService],
})
export class BillingModule {}
