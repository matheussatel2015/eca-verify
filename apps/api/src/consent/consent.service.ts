import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ConsentRecord } from './consent-record.entity';
import { runScoped } from '../tenant/tenant-scope';

@Injectable()
export class ConsentService {
  constructor(private readonly dataSource: DataSource) {}

  // Persists on the caller's RLS-scoped manager (same connection/tx that set app.tenant_id).
  //
  // CONTRACT — the caller MUST guarantee both of the following; this method does NOT
  // open or scope a transaction itself:
  //   1. `manager` belongs to a connection/transaction on which `app.tenant_id` has
  //      ALREADY been set (e.g. via runScoped / set_config('app.tenant_id', ...)).
  //      Passing an unscoped manager will write under whatever tenant scope (or none)
  //      that connection currently has — never pass an unscoped/raw manager.
  //   2. `record.tenantId` MUST equal the tenant currently scoped on that manager.
  // The DB RLS policy's `WITH CHECK` enforces (2) and will reject a mismatching
  // insert, but callers must not rely on that as their primary guard.
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
