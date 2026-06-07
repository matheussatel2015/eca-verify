import { Column, Entity, PrimaryColumn } from 'typeorm';

// NOTE: proof of physical deletion — NO biometric/image data ever.
@Entity('discard_log')
export class DiscardEvent {
  @PrimaryColumn('uuid') id!: string;
  @Column({ name: 'transaction_id', type: 'uuid' }) transactionId!: string;
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column() what!: string; // 'frame' | 'document'
  @Column({ name: 'discarded_at', type: 'timestamptz' }) discardedAt!: Date;
}
