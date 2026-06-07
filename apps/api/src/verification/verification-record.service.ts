import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { VerificationRecord } from './verification-record.entity';

@Injectable()
export class VerificationRecordService {
  // Persists on the caller's RLS-scoped EntityManager (same connection that set app.tenant_id).
  async saveWith(manager: EntityManager, record: VerificationRecord): Promise<void> {
    await manager.save(VerificationRecord, record);
  }
}
