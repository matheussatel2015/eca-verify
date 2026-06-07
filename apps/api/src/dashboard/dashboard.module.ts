import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { TenantModule } from '../tenant/tenant.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TenantModule, AuthModule], // TenantModule: ApiKeyService; AuthModule: DashboardAuthGuard
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
