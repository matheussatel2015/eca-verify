import { Column, Entity, PrimaryColumn } from 'typeorm';

// NOTE: decision metadata only — NO biometric/image data ever.
@Entity('verification_records')
export class VerificationRecord {
  @PrimaryColumn('uuid') id!: string; // = transaction_id
  @Column({ name: 'tenant_id', type: 'uuid' }) tenantId!: string;
  @Column() status!: string;
  @Column({ name: 'is_over_18' }) isOver18!: boolean;
  @Column() method!: string; // 'age_liveness' | 'document'
  @Column({ name: 'estimated_age', type: 'int', nullable: true }) estimatedAge!: number | null;
  @Column({ name: 'liveness_score', type: 'double precision', nullable: true }) livenessScore!: number | null;
  @Column({ name: 'cutoff_age', type: 'int' }) cutoffAge!: number;
  @Column({ type: 'int' }) margin!: number;
  @Column({ name: 'liveness_threshold', type: 'double precision' }) livenessThreshold!: number;
  @Column() provider!: string; // 'mock' | 'caf'
  @Column({ name: 'model_version' }) modelVersion!: string;
  @Column({ name: 'decision_reason' }) decisionReason!: string;
  @Column({ name: 'created_at', type: 'timestamptz' }) createdAt!: Date;
}
