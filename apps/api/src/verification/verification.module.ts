import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { Queue, type ConnectionOptions } from 'bullmq';
import { S3Client } from '@aws-sdk/client-s3';
import { VerificationSession } from '../session/session.entity';
import { DocumentSession } from '../session/document-session.entity';
import { Tenant } from '../tenant/tenant.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { VerificationController } from './verification.controller';
import { DocumentController } from './document.controller';
import { VerificationService } from './verification.service';
import { AuditService } from '../audit/audit.service';
import { WebhookService } from '../webhook/webhook.service';
import { buildAgeProvider } from './provider-factory';
import { loadDecisionConfig, encryptionKey, loadProviderConfig } from '../config';
import { FRAME_STORE } from '../storage/frame-store.port';
import { S3FrameStore } from '../storage/s3-frame-store';
import { VerificationQueue } from '../queue/verification.queue';
import { VERIFICATION_QUEUE_NAME } from '../queue/verification-job';
import { DocumentQueue } from '../queue/document.queue';
import { DOCUMENT_QUEUE_NAME } from '../queue/document-job';
import { RateLimitGuard, RATE_LIMITER } from '../ratelimit/rate-limit.guard';
import { RateLimiter } from '../ratelimit/rate-limiter';
import { IoRedisAdapter } from '../redis/ioredis.adapter';

@Module({
  imports: [TypeOrmModule.forFeature([VerificationSession, DocumentSession, Tenant, AuditLog])],
  controllers: [VerificationController, DocumentController],
  providers: [
    AuditService,
    { provide: WebhookService, useFactory: () => new WebhookService() },
    {
      provide: VerificationService,
      inject: [AuditService, WebhookService],
      useFactory: (audit: AuditService, webhook: WebhookService) =>
        new VerificationService(
          buildAgeProvider(loadProviderConfig(process.env)),
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
          // Cast required: bullmq@5.78 bundles its own nested ioredis whose Redis type is structurally distinct from the root ioredis. Runtime accepts the instance fine.
          new Queue(VERIFICATION_QUEUE_NAME, { connection: new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null }) as unknown as ConnectionOptions }),
        ),
    },
    {
      provide: DocumentQueue,
      useFactory: () =>
        new DocumentQueue(
          // Cast required: bullmq@5.78 bundles its own nested ioredis whose Redis type is structurally distinct from the root ioredis. Runtime accepts the instance fine.
          new Queue(DOCUMENT_QUEUE_NAME, { connection: new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null }) as unknown as ConnectionOptions }),
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
