import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { shapeStats, StatsSummary } from './dashboard-stats';
import { Pagination } from './pagination';

export interface AuditPage {
  items: Array<{ id: string; masked_ip: string; status: string; created_at: Date }>;
  total: number;
  limit: number;
  offset: number;
}

@Injectable()
export class DashboardService {
  constructor(private readonly dataSource: DataSource) {}

  // audit_logs has FORCE RLS — reads must run on a connection with app.tenant_id set.
  private async scoped<T>(tenantId: string, fn: (mgr: EntityManager) => Promise<T>): Promise<T> {
    const qr = this.dataSource.createQueryRunner();
    await qr.connect();
    try {
      await qr.query(`SELECT set_config('app.tenant_id', $1, false)`, [tenantId]);
      return await fn(qr.manager);
    } finally {
      await qr.release();
    }
  }

  async getStats(tenantId: string, from: Date, to: Date): Promise<StatsSummary> {
    return this.scoped(tenantId, async (mgr) => {
      const rows = await mgr.query(
        `SELECT status, COUNT(*)::int AS count FROM audit_logs WHERE created_at BETWEEN $1 AND $2 GROUP BY status`,
        [from, to],
      );
      return shapeStats(rows);
    });
  }

  async getAudit(tenantId: string, page: Pagination, status?: string): Promise<AuditPage> {
    return this.scoped(tenantId, async (mgr) => {
      const where = status ? `WHERE status = $3` : ``;
      const items = await mgr.query(
        `SELECT id, masked_ip, status, created_at FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
        status ? [page.limit, page.offset, status] : [page.limit, page.offset],
      );
      const countRows = await mgr.query(
        `SELECT COUNT(*)::int AS count FROM audit_logs ${status ? 'WHERE status = $1' : ''}`,
        status ? [status] : [],
      );
      return { items, total: countRows[0]?.count ?? 0, limit: page.limit, offset: page.offset };
    });
  }
}
