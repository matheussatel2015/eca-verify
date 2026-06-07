import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('tenants')
export class Tenant {
  @PrimaryColumn('uuid') id!: string;
  @Column() name!: string;
  @Column({ name: 'webhook_url' }) webhookUrl!: string;
  // Stored encrypted (AES-256-GCM token) via secret-crypto; decrypted only at dispatch time.
  @Column({ name: 'webhook_secret' }) webhookSecret!: string;
  @Column({ name: 'plan_id', default: 'free' }) planId!: string;
  @Column({ name: 'required_age', type: 'int', default: 18 }) requiredAge!: number;
  @Column({ name: 'stripe_customer_id', type: 'text', nullable: true }) stripeCustomerId!: string | null;
  @Column({ name: 'stripe_subscription_id', type: 'text', nullable: true }) stripeSubscriptionId!: string | null;
}
