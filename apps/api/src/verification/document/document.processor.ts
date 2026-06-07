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
import { runScoped } from '../../tenant/tenant-scope';
import { VerificationRecordService } from '../verification-record.service';
import { ProofService } from '../../proof/proof.service';
import { buildDocumentRecord } from './document-record-builder';

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
    private readonly records: VerificationRecordService = new VerificationRecordService(),
    private readonly proof: ProofService | null = null,
    private readonly discard?: import('../../erasure/discard.service').DiscardService,
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
      const status = decideDocument({ ageFromDoc, faceMatchScore: out.faceMatchScore, identical: out.identical }, this.cfg.cutoffAge, Number(process.env.DOC_FACEMATCH_MIN ?? 0.8));
      const payload: WebhookPayload = { transaction_id: job.transactionId, status, is_over_18: isOver18(status) };

      await runScoped(this.dataSource, job.tenantId, async (mgr) => {
        const tenant = await mgr.findOneOrFail(Tenant, { where: { id: job.tenantId } });
        await this.audit.record({ transactionId: job.transactionId, tenantId: job.tenantId, rawIp: job.rawIp, status, now: new Date() }, mgr);
        // Sign the proof first so it can be stored verbatim alongside the method trail.
        const signedJwt = this.proof
          ? await this.proof.sign({ transaction_id: job.transactionId, tenant_id: job.tenantId, status, is_over_18: payload.is_over_18, method: 'document' })
          : null;
        if (signedJwt) payload.proof = signedJwt;
        const record = buildDocumentRecord({
          transactionId: job.transactionId, tenantId: job.tenantId, status,
          ageFromDoc, faceMatchScore: out.faceMatchScore, cutoffAge: this.cfg.cutoffAge,
          provider: process.env.DOC_VERIFIER_KIND ?? 'mock', modelVersion: process.env.MODEL_VERSION ?? 'mock-1',
          now: new Date(),
        }) as any;
        record.proofJwt = signedJwt ?? null;
        await this.records.saveWith(mgr, record);
        await this.webhook.dispatch(tenant.webhookUrl, decryptSecret(tenant.webhookSecret, this.key), payload);
      });
    } finally {
      zero(docFrame);
      zero(selfieFrame);
      await this.store.delete(job.documentRef);
      await this.store.delete(job.selfieRef);
      await this.discard?.record({ transactionId: job.transactionId, tenantId: job.tenantId, what: 'document', now: new Date() });
    }
  }
}
