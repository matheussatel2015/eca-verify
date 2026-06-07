import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('dashboard_users')
export class DashboardUser {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  // Dashboard login email is GLOBALLY unique by design: one dashboard login = one email = one tenant.
  // Per-tenant duplicate emails are intentionally not supported in this iteration.
  @Index({ unique: true })
  @Column() email!: string;
  @Column({ name: 'password_hash' }) passwordHash!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
