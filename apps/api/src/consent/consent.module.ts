import { Module } from '@nestjs/common';
import { TenantModule } from '../tenant/tenant.module';
import { ConsentService } from './consent.service';
import { ConsentController } from './consent.controller';

@Module({
  imports: [TenantModule], // ApiKeyGuard
  controllers: [ConsentController],
  providers: [ConsentService],
  exports: [ConsentService], // consumed by SessionModule
})
export class ConsentModule {}
