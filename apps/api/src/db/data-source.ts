import { DataSource } from 'typeorm';
import { Tenant } from '../tenant/tenant.entity';
import { VerificationSession } from '../session/session.entity';
import { AuditLog } from '../audit/audit-log.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [Tenant, VerificationSession, AuditLog],
  migrations: ['src/db/migrations/*.ts'],
  synchronize: false,
});
