import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('document_sessions')
export class DocumentSession {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column({ name: 'transaction_id', type: 'uuid' }) transactionId!: string;
  @Column({ name: 'session_token' }) sessionToken!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
