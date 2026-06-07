import { Column, Entity, PrimaryColumn } from 'typeorm';

// NOTE: consent metadata only — NO biometric/image data ever.
@Entity('consent_records')
export class ConsentRecord {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'user_hash' }) userHash!: string;
  @Column({ name: 'policy_version' }) policyVersion!: string;
  @Column() scope!: string; // e.g. 'age_verification'
  @Column({ name: 'masked_ip' }) maskedIp!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
