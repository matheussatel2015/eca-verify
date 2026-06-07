import { Module } from '@nestjs/common';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { DashboardUser } from './dashboard-user.entity';
import { Tenant } from '../tenant/tenant.entity';
import { TenantModule } from '../tenant/tenant.module';
import { AuthController } from './auth.controller';
import { DashboardAuthService } from './dashboard-auth.service';
import { DashboardAuthGuard } from './dashboard-auth.guard';
import { RateLimitGuard, RATE_LIMITER } from '../ratelimit/rate-limit.guard';
import { RateLimiter } from '../ratelimit/rate-limiter';
import { IoRedisAdapter } from '../redis/ioredis.adapter';
import { dashboardJwtSecret, dashboardJwtTtl } from '../config';

@Module({
  imports: [TypeOrmModule.forFeature([DashboardUser, Tenant]), TenantModule],
  controllers: [AuthController],
  providers: [
    {
      provide: DashboardAuthService,
      inject: [getRepositoryToken(DashboardUser)],
      useFactory: (repo: Repository<DashboardUser>) =>
        new DashboardAuthService(repo, dashboardJwtSecret(process.env), dashboardJwtTtl(process.env)),
    },
    DashboardAuthGuard,
    {
      provide: RATE_LIMITER,
      useFactory: () => new RateLimiter(new IoRedisAdapter(new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379'))),
    },
    RateLimitGuard,
  ],
  exports: [DashboardAuthService, DashboardAuthGuard],
})
export class AuthModule {}
