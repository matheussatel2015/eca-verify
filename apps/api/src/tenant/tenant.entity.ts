import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('tenants')
export class Tenant {
  @PrimaryColumn('uuid') id!: string;
  @Column() name!: string;
  @Column({ name: 'api_key_hash' }) apiKeyHash!: string;
  @Column({ name: 'webhook_url' }) webhookUrl!: string;
  @Column({ name: 'webhook_secret' }) webhookSecret!: string;
}
