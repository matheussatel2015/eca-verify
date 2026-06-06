import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Tenant } from './tenant.entity';
import { ApiKey } from './api-key.entity';
import { ApiKeyGuard } from './api-key.guard';
import { ApiKeyService } from './api-key.service';
import { TenantService, SECRET_KEY } from './tenant.service';
import { TenantController } from './tenant.controller';
import { encryptionKey } from '../config';

@Module({
  imports: [TypeOrmModule.forFeature([Tenant, ApiKey])],
  controllers: [TenantController],
  providers: [
    { provide: SECRET_KEY, useFactory: () => encryptionKey(process.env) },
    ApiKeyGuard,
    ApiKeyService,
    TenantService,
  ],
  exports: [ApiKeyGuard, ApiKeyService, TypeOrmModule],
})
export class TenantModule {}
