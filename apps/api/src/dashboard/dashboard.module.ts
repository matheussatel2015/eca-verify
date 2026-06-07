import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [TenantModule], // provides ApiKeyGuard + ApiKeyService
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
