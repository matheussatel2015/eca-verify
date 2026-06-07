import { Injectable } from '@nestjs/common';
import { DecisionConfig, WebhookPayload } from '@eca/sdk-types';
import { AgeProviderPort } from './age-provider.port';
import { AuditService } from '../audit/audit.service';
import { WebhookService } from '../webhook/webhook.service';
import { decideVerification, isOver18 } from './decision';
import { decryptFrame, zero, EncryptedFrame } from './crypto.util';
import { buildAgeRecord } from './record-builder';
import { VerificationRecordService } from './verification-record.service';
import { ProofService } from '../proof/proof.service';

interface VerifyArgs {
  transactionId: string;
  tenantId: string;
  rawIp: string;
  webhookUrl: string;
  webhookSecret: string;
  encryptedFrame: EncryptedFrame;
  auditManager?: import('typeorm').EntityManager;
  issueDocumentSession?: () => Promise<string>;
  provider?: string;        // 'mock' | 'caf' — for the audit record
  modelVersion?: string;    // for the audit record
  recordManager?: import('typeorm').EntityManager; // RLS-scoped manager to persist the record
}

@Injectable()
export class VerificationService {
  constructor(
    private readonly provider: AgeProviderPort,
    private readonly audit: AuditService,
    private readonly webhook: WebhookService,
    private readonly cfg: DecisionConfig,
    private readonly key: Buffer,
    private readonly records: VerificationRecordService,
    private readonly proof: ProofService | null,
  ) {}

  async verify(args: VerifyArgs): Promise<WebhookPayload> {
    let frame: Buffer = Buffer.alloc(0);
    try {
      frame = decryptFrame(args.encryptedFrame, this.key);
      const providerResult = await this.provider.analyze(frame);
      const status = decideVerification(providerResult, this.cfg);
      const payload: WebhookPayload = {
        transaction_id: args.transactionId,
        status,
        is_over_18: isOver18(status),
      };
      if (status === 'documento_requerido' && args.issueDocumentSession) {
        payload.document_session_token = await args.issueDocumentSession();
      }
      await this.audit.record({ transactionId: args.transactionId, tenantId: args.tenantId, rawIp: args.rawIp, status, now: new Date() }, args.auditManager);
      // Auditable method trail (no biometrics) — persisted on the RLS-scoped manager when provided.
      if (args.recordManager) {
        const record = buildAgeRecord({
          transactionId: args.transactionId, tenantId: args.tenantId,
          result: providerResult, cfg: this.cfg, status,
          provider: args.provider ?? 'mock', modelVersion: args.modelVersion ?? 'unknown', now: new Date(),
        });
        await this.records.saveWith(args.recordManager, record as any);
      }
      // Signed proof artifact for the tenant's evidence (if proof signing is configured).
      if (this.proof) {
        payload.proof = await this.proof.sign({
          transaction_id: args.transactionId, tenant_id: args.tenantId,
          status, is_over_18: payload.is_over_18, method: 'age_liveness',
        });
      }
      await this.webhook.dispatch(args.webhookUrl, args.webhookSecret, payload);
      return payload;
    } finally {
      // Privacy by Design: the frame never outlives this call.
      zero(frame);
    }
  }
}
