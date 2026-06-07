import { DataSource } from 'typeorm';
import { randomUUID, randomBytes } from 'crypto';
import { Tenant } from '../tenant/tenant.entity';
import { DocumentSession } from '../session/document-session.entity';
import { FrameStorePort } from '../storage/frame-store.port';
import { deserializeFrame } from '../storage/frame-codec';
import { VerificationService } from './verification.service';
import { VerificationJob } from '../queue/verification-job';
import { OnceGuard } from '../queue/once-guard';
import { decryptSecret } from '../tenant/secret-crypto';

export class VerificationProcessor {
  constructor(
    private readonly store: FrameStorePort,
    private readonly dataSource: DataSource,
    private readonly service: VerificationService,
    private readonly once: OnceGuard,
    private readonly key: Buffer,
    private readonly onceTtlMs: number = 24 * 60 * 60 * 1000,
  ) {}

  async process(job: VerificationJob): Promise<void> {
    try {
      const bytes = await this.store.get(job.frameRef);
      if (!bytes) throw new Error(`frame ${job.frameRef} expired or missing`);
      // Exactly-once: a BullMQ retry after a mid-job crash must not re-run verification/webhook.
      const fresh = await this.once.acquire(job.transactionId, this.onceTtlMs);
      if (!fresh) return;
      const encryptedFrame = deserializeFrame(bytes);

      const qr = this.dataSource.createQueryRunner();
      await qr.connect();
      try {
        // Session-level RLS scope so the audit INSERT on THIS connection satisfies the policy.
        await qr.query(`SELECT set_config('app.tenant_id', $1, false)`, [job.tenantId]);
        const tenant = await qr.manager.findOneOrFail(Tenant, { where: { id: job.tenantId } });
        await this.service.verify({
          transactionId: job.transactionId,
          tenantId: job.tenantId,
          rawIp: job.rawIp,
          webhookUrl: tenant.webhookUrl,
          webhookSecret: decryptSecret(tenant.webhookSecret, this.key),
          encryptedFrame,
          auditManager: qr.manager,
          issueDocumentSession: async () => {
            const token = randomBytes(24).toString('hex');
            await qr.manager.save(DocumentSession, {
              id: randomUUID(),
              tenantId: job.tenantId,
              transactionId: job.transactionId,
              sessionToken: token,
              createdAt: new Date(),
            });
            return token;
          },
        });
      } finally {
        await qr.release();
      }
    } finally {
      // Physical deletion of the temporary media — always, even if the frame was missing/expired.
      await this.store.delete(job.frameRef);
    }
  }
}
