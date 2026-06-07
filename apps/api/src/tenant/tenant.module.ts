import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant.entity';
import { ApiKey } from './api-key.entity';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';
import { TenantService, SECRET_KEY } from './tenant.service';
import { TenantSettingsService } from './tenant-settings.service';
import { TenantController } from './tenant.controller';
import { encryptionKey } from '../config';
import Redis from 'ioredis';
import { RateLimitGuard, RATE_LIMITER } from '../ratelimit/rate-limit.guard';
import { RateLimiter } from '../ratelimit/rate-limiter';
import { IoRedisAdapter } from '../redis/ioredis.adapter';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, ApiKey])],
  controllers: [TenantController],
  providers: [
    { provide: SECRET_KEY, useFactory: () => encryptionKey(process.env) },
    ApiKeyGuard,
    ApiKeyService,
    TenantService,
    TenantSettingsService,
    {
      provide: RATE_LIMITER,
      useFactory: () => new RateLimiter(new IoRedisAdapter(new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379'))),
    },
    RateLimitGuard,
  ],
  exports: [ApiKeyGuard, ApiKeyService, TypeOrmModule],
})
export class TenantModule {}
