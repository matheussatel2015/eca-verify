import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('sessions')
export class VerificationSession {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'user_hash' }) userHash!: string;
  @Column({ name: 'session_token' }) sessionToken!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
