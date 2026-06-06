import { Repository } from 'typeorm';
import { Tenant } from '../tenant/tenant.entity';
import { FrameStorePort } from '../storage/frame-store.port';
import { deserializeFrame } from '../storage/frame-codec';
import { VerificationService } from './verification.service';
import { VerificationJob } from '../queue/verification-job';

export class VerificationProcessor {
  constructor(
    private readonly store: FrameStorePort,
    private readonly tenants: Repository<Tenant>,
    private readonly service: VerificationService,
  ) {}

  async process(job: VerificationJob): Promise<void> {
    const bytes = await this.store.get(job.frameRef);
    if (!bytes) throw new Error(`frame ${job.frameRef} expired or missing`);
    try {
      const encryptedFrame = deserializeFrame(bytes);
      const tenant = await this.tenants.findOneOrFail({ where: { id: job.tenantId } });
      await this.service.verify({
        transactionId: job.transactionId,
        tenantId: job.tenantId,
        rawIp: job.rawIp,
        webhookUrl: tenant.webhookUrl,
        webhookSecret: tenant.webhookSecret,
        encryptedFrame,
      });
    } finally {
      // Privacy by Design: physical, immediate deletion of the temporary media.
      await this.store.delete(job.frameRef);
    }
  }
}
