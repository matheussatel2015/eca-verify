import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('api_keys')
export class ApiKey {
  @PrimaryColumn('uuid') id!: string;
  @Index()
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Index({ unique: true })
  @Column({ name: 'key_hash' }) keyHash!: string;
  @Column({ nullable: true, type: 'text' }) label!: string | null;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true }) revokedAt!: Date | null;
}
