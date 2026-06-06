import { Column, Entity, PrimaryColumn } from 'typeorm';

// NOTE: by design this entity has NO biometric/image column. Do not add one.
@Entity('audit_logs')
export class AuditLog {
  @PrimaryColumn('uuid') id!: string; // transaction_id
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'masked_ip' }) maskedIp!: string;
  @Column() status!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
