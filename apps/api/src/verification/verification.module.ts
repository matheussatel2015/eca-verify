import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Queue, type ConnectionOptions } from 'bullmq';
import { S3Client } from '@aws-sdk/client-s3';
import { VerificationSession } from '../session/session.entity';
import { Tenant } from '../tenant/tenant.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { AuditService } from '../audit/audit.service';
import { WebhookService } from '../webhook/webhook.service';
import { MockAgeProvider } from './mock-age-provider';
import { loadDecisionConfig, encryptionKey } from '../config';
import { FRAME_STORE } from '../storage/frame-store.port';
import { S3FrameStore } from '../storage/s3-frame-store';
import { VerificationQueue } from '../queue/verification.queue';
import { VERIFICATION_QUEUE_NAME } from '../queue/verification-job';
import { RateLimitGuard, RATE_LIMITER } from '../ratelimit/rate-limit.guard';
import { RateLimiter } from '../ratelimit/rate-limiter';
import { IoRedisAdapter } from '../redis/ioredis.adapter';

@Module({
  imports: [TypeOrmModule.forFeature([VerificationSession, Tenant, AuditLog])],
  controllers: [VerificationController],
  providers: [
    AuditService,
    { provide: WebhookService, useFactory: () => new WebhookService() },
    {
      provide: VerificationService,
      inject: [AuditService, WebhookService],
      useFactory: (audit: AuditService, webhook: WebhookService) =>
        new VerificationService(
          new MockAgeProvider({ estimatedAge: 30, livenessScore: 0.95 }),
          audit,
          webhook,
          loadDecisionConfig(process.env),
          encryptionKey(process.env),
        ),
    },
    {
      provide: FRAME_STORE,
      useFactory: () =>
        new S3FrameStore(
          new S3Client({
            region: process.env.AWS_REGION,
            endpoint: process.env.AWS_ENDPOINT,
            forcePathStyle: true,
          }),
          process.env.FRAME_BUCKET ?? 'eca-frames-temp',
        ),
    },
    {
      provide: VerificationQueue,
      useFactory: () =>
        new VerificationQueue(
          new Queue(VERIFICATION_QUEUE_NAME, { connection: new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null }) as unknown as ConnectionOptions }),
        ),
    },
    {
      provide: RATE_LIMITER,
      useFactory: () => new RateLimiter(new IoRedisAdapter(new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379'))),
    },
    RateLimitGuard,
  ],
})
export class VerificationModule {}
