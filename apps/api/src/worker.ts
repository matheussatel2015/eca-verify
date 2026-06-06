import 'reflect-metadata';
import Redis from 'ioredis';
import { Worker, type ConnectionOptions } from 'bullmq';
import { S3Client } from '@aws-sdk/client-s3';
import { AppDataSource } from './db/data-source';
import { AuditLog } from './audit/audit-log.entity';
import { S3FrameStore } from './storage/s3-frame-store';
import { VerificationProcessor } from './verification/verification.processor';
import { VerificationService } from './verification/verification.service';
import { AuditService } from './audit/audit.service';
import { WebhookService } from './webhook/webhook.service';
import { MockAgeProvider } from './verification/mock-age-provider';
import { loadDecisionConfig, encryptionKey } from './config';
import { VERIFICATION_QUEUE_NAME, VerificationJob } from './queue/verification-job';
import { OnceGuard } from './queue/once-guard';
import { IoRedisAdapter } from './redis/ioredis.adapter';

async function main() {
  await AppDataSource.initialize();
  const auditRepo = AppDataSource.getRepository(AuditLog);

  const audit = new AuditService(auditRepo);
  const webhook = new WebhookService();
  const service = new VerificationService(
    new MockAgeProvider({ estimatedAge: 30, livenessScore: 0.95 }),
    audit,
    webhook,
    loadDecisionConfig(process.env),
    encryptionKey(process.env),
  );
  const store = new S3FrameStore(
    new S3Client({ region: process.env.AWS_REGION, endpoint: process.env.AWS_ENDPOINT, forcePathStyle: true }),
    process.env.FRAME_BUCKET ?? 'eca-frames-temp',
  );
  const once = new OnceGuard(new IoRedisAdapter(new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')));
  const processor = new VerificationProcessor(store, AppDataSource, service, once);

  const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const worker = new Worker<VerificationJob>(
    VERIFICATION_QUEUE_NAME,
    async (job) => { await processor.process(job.data); },
    // Cast required: bullmq@5.78 bundles its own nested ioredis whose Redis type is structurally distinct from the root ioredis. Runtime accepts the instance fine.
    { connection: connection as unknown as ConnectionOptions, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 8) },
  );

  const shutdown = async () => { await worker.close(); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  worker.on('completed', (job) => console.log(`job ${job.id} completed`));
  worker.on('failed', (job, err) => console.error(`job ${job?.id} failed:`, err.message));
  console.log('verification worker started');
}
main().catch((err) => { console.error('worker startup failed:', err); process.exit(1); });
