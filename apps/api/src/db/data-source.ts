import { join } from 'path';
import { DataSource } from 'typeorm';
import { Tenant } from '../tenant/tenant.entity';
import { ApiKey } from '../tenant/api-key.entity';
import { VerificationSession } from '../session/session.entity';
import { DocumentSession } from '../session/document-session.entity';
import { AuditLog } from '../audit/audit-log.entity';
import { VerificationRecord } from '../verification/verification-record.entity';
import { ConsentRecord } from '../consent/consent-record.entity';
import { DiscardEvent } from '../erasure/discard-event.entity';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities: [Tenant, ApiKey, VerificationSession, DocumentSession, AuditLog, VerificationRecord, ConsentRecord, DiscardEvent],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
});
