import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ConsentRecord } from './consent-record.entity';
import { runScoped } from '../tenant/tenant-scope';

@Injectable()
export class ConsentService {
  constructor(private readonly dataSource: DataSource) {}

  // Persists on the caller's RLS-scoped manager (same connection/tx that set app.tenant_id).
  async saveWith(manager: EntityManager, record: ConsentRecord): Promise<void> {
    await manager.save(ConsentRecord, record);
  }

  // Data-subject access: list this tenant's consent records for one user_hash (RLS-scoped).
  async listByUserHash(tenantId: string, userHash: string): Promise<ConsentRecord[]> {
    return runScoped(this.dataSource, tenantId, (mgr) =>
      mgr.find(ConsentRecord, { where: { userHash }, order: { createdAt: 'DESC' } }),
    );
  }
}
