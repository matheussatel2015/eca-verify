import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Tenant } from './tenant.entity';
import { runScoped } from './tenant-scope';

export const MIN_REQUIRED_AGE = 1;
export const MAX_REQUIRED_AGE = 120;

@Injectable()
export class TenantSettingsService {
  constructor(private readonly dataSource: DataSource) {}

  async getRequiredAge(tenantId: string): Promise<number> {
    return runScoped(this.dataSource, tenantId, async (mgr) => {
      const tenant = await mgr.findOneOrFail(Tenant, { where: { id: tenantId } });
      return tenant.requiredAge;
    });
  }

  async setRequiredAge(tenantId: string, requiredAge: number): Promise<number> {
    if (!Number.isInteger(requiredAge) || requiredAge < MIN_REQUIRED_AGE || requiredAge > MAX_REQUIRED_AGE) {
      throw new Error(`required_age must be an integer in [${MIN_REQUIRED_AGE}, ${MAX_REQUIRED_AGE}]`);
    }
    return runScoped(this.dataSource, tenantId, async (mgr) => {
      // RLS WITH CHECK guarantees the row belongs to this tenant.
      await mgr.update(Tenant, tenantId, { requiredAge });
      return requiredAge;
    });
  }
}
