import { DataSource } from 'typeorm';
import { DecisionConfig, WebhookPayload } from '@eca/sdk-types';
import { Tenant } from '../../tenant/tenant.entity';
import { FrameStorePort } from '../../storage/frame-store.port';
import { deserializeFrame } from '../../storage/frame-codec';
import { decryptFrame, zero } from '../crypto.util';
import { decryptSecret } from '../../tenant/secret-crypto';
import { DocumentVerifierPort } from './document-verifier.port';
import { ageFromBirthDate, decideDocument } from './document-decision';
import { isOver18 } from '../decision';
import { AuditService } from '../../audit/audit.service';
import { WebhookService } from '../../webhook/webhook.service';
import { OnceGuard } from '../../queue/once-guard';
import { DocumentJob } from '../../queue/document-job';

export class DocumentProcessor {
  constructor(
    private readonly store: FrameStorePort,
    private readonly dataSource: DataSource,
    private readonly verifier: DocumentVerifierPort,
    private readonly audit: AuditService,
    private readonly webhook: WebhookService,
    private readonly once: OnceGuard,
    private readonly key: Buffer,
    private readonly cfg: DecisionConfig,
    private readonly onceTtlMs: number = 24 * 60 * 60 * 1000,
  ) {}

  async process(job: DocumentJob): Promise<void> {
    let docFrame: Buffer = Buffer.alloc(0);
    let selfieFrame: Buffer = Buffer.alloc(0);
    try {
      const docBytes = await this.store.get(job.documentRef);
      const selfieBytes = await this.store.get(job.selfieRef);
      if (!docBytes || !selfieBytes) throw new Error(`document images for ${job.transactionId} expired or missing`);
      if (!(await this.once.acquire(`doc:${job.transactionId}`, this.onceTtlMs))) return;

      docFrame = decryptFrame(deserializeFrame(docBytes), this.key);
      selfieFrame = decryptFrame(deserializeFrame(selfieBytes), this.key);
      const out = await this.verifier.verify({ documentImage: docFrame, selfieImage: selfieFrame });
      const ageFromDoc = out.birthDate ? ageFromBirthDate(out.birthDate, new Date()) : null;
      const status = decideDocument({ ageFromDoc, faceMatchScore: out.faceMatchScore, identical: out.identical }, this.cfg.cutoffAge);
      const payload: WebhookPayload = { transaction_id: job.transactionId, status, is_over_18: isOver18(status) };

      const qr = this.dataSource.createQueryRunner();
      await qr.connect();
      try {
        await qr.query(`SELECT set_config('app.tenant_id', $1, false)`, [job.tenantId]);
        const tenant = await qr.manager.findOneOrFail(Tenant, { where: { id: job.tenantId } });
        await this.audit.record({ transactionId: job.transactionId, tenantId: job.tenantId, rawIp: job.rawIp, status, now: new Date() }, qr.manager);
        await this.webhook.dispatch(tenant.webhookUrl, decryptSecret(tenant.webhookSecret, this.key), payload);
      } finally {
        await qr.release();
      }
    } finally {
      zero(docFrame);
      zero(selfieFrame);
      await this.store.delete(job.documentRef);
      await this.store.delete(job.selfieRef);
    }
  }
}
