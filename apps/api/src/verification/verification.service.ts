import { Injectable } from '@nestjs/common';
import { DecisionConfig, WebhookPayload } from '@eca/sdk-types';
import { AgeProviderPort } from './age-provider.port';
import { AuditService } from '../audit/audit.service';
import { WebhookService } from '../webhook/webhook.service';
import { decideVerification, isOver18 } from './decision';
import { decryptFrame, zero, EncryptedFrame } from './crypto.util';

interface VerifyArgs {
  transactionId: string;
  tenantId: string;
  rawIp: string;
  webhookUrl: string;
  webhookSecret: string;
  encryptedFrame: EncryptedFrame;
  auditManager?: import('typeorm').EntityManager;
}

@Injectable()
export class VerificationService {
  constructor(
    private readonly provider: AgeProviderPort,
    private readonly audit: AuditService,
    private readonly webhook: WebhookService,
    private readonly cfg: DecisionConfig,
    private readonly key: Buffer,
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
      await this.audit.record({ transactionId: args.transactionId, tenantId: args.tenantId, rawIp: args.rawIp, status, now: new Date() }, args.auditManager);
      await this.webhook.dispatch(args.webhookUrl, args.webhookSecret, payload);
      return payload;
    } finally {
      // Privacy by Design: the frame never outlives this call.
      zero(frame);
    }
  }
}
