import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { VerificationSession } from './session.entity';
import { SessionController } from './session.controller';
import { TenantModule } from '../tenant/tenant.module';

@Module({
  imports: [TypeOrmModule.forFeature([VerificationSession]), TenantModule],
  controllers: [SessionController],
})
export class SessionModule {}
