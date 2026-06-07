import { Module } from '@nestjs/common';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DashboardUser } from './dashboard-user.entity';
import { Tenant } from '../tenant/tenant.entity';
import { TenantModule } from '../tenant/tenant.module';
import { AuthController } from './auth.controller';
import { DashboardAuthService } from './dashboard-auth.service';
import { DashboardAuthGuard } from './dashboard-auth.guard';
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
  ],
  exports: [DashboardAuthService, DashboardAuthGuard],
})
export class AuthModule {}
