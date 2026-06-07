import 'reflect-metadata';
import Redis from 'ioredis';
import { Worker, type ConnectionOptions } from 'bullmq';
import { S3Client } from '@aws-sdk/client-s3';
import { AppDataSource } from './db/data-source';
import { AuditLog } from './audit/audit-log.entity';
import { S3FrameStore } from './storage/s3-frame-store';
import { VerificationProcessor } from './verification/verification.processor';
import { VerificationService } from './verification/verification.service';
import { DocumentProcessor } from './verification/document/document.processor';
import { AuditService } from './audit/audit.service';
import { WebhookService } from './webhook/webhook.service';
import { buildAgeProvider, buildDocumentVerifier } from './verification/provider-factory';
import { CafClient } from './verification/caf/caf-client';
import { loadDecisionConfig, encryptionKey, loadProviderConfig } from './config';
import { VERIFICATION_QUEUE_NAME, VerificationJob } from './queue/verification-job';
import { DOCUMENT_QUEUE_NAME, DocumentJob } from './queue/document-job';
import { OnceGuard } from './queue/once-guard';
import { IoRedisAdapter } from './redis/ioredis.adapter';

async function main() {
  await AppDataSource.initialize();
  const auditRepo = AppDataSource.getRepository(AuditLog);

  const audit = new AuditService(auditRepo);
  const webhook = new WebhookService();
  const key = encryptionKey(process.env);
  const providerCfg = loadProviderConfig(process.env);
  const cafClient = providerCfg.caf ? new CafClient(providerCfg.caf) : undefined;
  const service = new VerificationService(
    buildAgeProvider(providerCfg, cafClient),
    audit,
    webhook,
    loadDecisionConfig(process.env),
    key,
  );
  const store = new S3FrameStore(
    new S3Client({ region: process.env.AWS_REGION, endpoint: process.env.AWS_ENDPOINT, forcePathStyle: true }),
    process.env.FRAME_BUCKET ?? 'eca-frames-temp',
  );
  const onceRedis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  const once = new OnceGuard(new IoRedisAdapter(onceRedis));
  const processor = new VerificationProcessor(store, AppDataSource, service, once, key);
  const documentProcessor = new DocumentProcessor(
    store,
    AppDataSource,
    buildDocumentVerifier(providerCfg, cafClient),
    audit,
    webhook,
    once,
    key,
    loadDecisionConfig(process.env),
  );

  const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const worker = new Worker<VerificationJob>(
    VERIFICATION_QUEUE_NAME,
    async (job) => { await processor.process(job.data); },
    // Cast required: bullmq@5.78 bundles its own nested ioredis whose Redis type is structurally distinct from the root ioredis. Runtime accepts the instance fine.
    { connection: connection as unknown as ConnectionOptions, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 8) },
  );

  const documentConnection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const documentWorker = new Worker<DocumentJob>(
    DOCUMENT_QUEUE_NAME,
    async (job) => { await documentProcessor.process(job.data); },
    // Cast required: bullmq@5.78 bundles its own nested ioredis whose Redis type is structurally distinct from the root ioredis. Runtime accepts the instance fine.
    { connection: documentConnection as unknown as ConnectionOptions, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 8) },
  );

  const shutdown = async () => {
    // Order: stop accepting/processing jobs, release redis connections, then close the DB pool.
    await worker.close();
    await documentWorker.close();
    await Promise.all([connection.quit(), documentConnection.quit(), onceRedis.quit()]);
    await AppDataSource.destroy();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  worker.on('completed', (job) => console.log(`job ${job.id} completed`));
  worker.on('failed', (job, err) => console.error(`job ${job?.id} failed:`, err.message));
  documentWorker.on('completed', (job) => console.log(`document job ${job.id} completed`));
  documentWorker.on('failed', (job, err) => console.error(`document job ${job?.id} failed:`, err.message));
  console.log('verification + document workers started');
}
main().catch((err) => { console.error('worker startup failed:', err); process.exit(1); });
