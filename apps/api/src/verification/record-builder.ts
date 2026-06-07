import { AgeProviderResult, DecisionConfig, VerificationStatus } from '@eca/sdk-types';
import { isOver18 } from './decision';

export function explainAgeDecision(result: AgeProviderResult, cfg: DecisionConfig, status: VerificationStatus): string {
  if (status === 'reprovado' && result.livenessScore < cfg.livenessThreshold) {
    return `liveness ${result.livenessScore} < limiar ${cfg.livenessThreshold}`;
  }
  if (status === 'aprovado') {
    return `idade estimada ${result.estimatedAge} >= corte ${cfg.cutoffAge} + margem ${cfg.margin} = ${cfg.cutoffAge + cfg.margin}`;
  }
  if (status === 'reprovado') {
    return `idade estimada ${result.estimatedAge} < corte ${cfg.cutoffAge} - margem ${cfg.margin} (${cfg.cutoffAge - cfg.margin})`;
  }
  return `idade estimada ${result.estimatedAge} na zona cinzenta [${cfg.cutoffAge - cfg.margin}, ${cfg.cutoffAge + cfg.margin}) — documento requerido`;
}

export interface AgeRecordInput {
  transactionId: string;
  tenantId: string;
  result: AgeProviderResult;
  cfg: DecisionConfig;
  status: VerificationStatus;
  provider: string;
  modelVersion: string;
  now: Date;
}

export function buildAgeRecord(input: AgeRecordInput) {
  return {
    id: input.transactionId,
    tenantId: input.tenantId,
    status: input.status,
    isOver18: isOver18(input.status),
    method: 'age_liveness',
    estimatedAge: input.result.estimatedAge,
    livenessScore: input.result.livenessScore,
    cutoffAge: input.cfg.cutoffAge,
    margin: input.cfg.margin,
    livenessThreshold: input.cfg.livenessThreshold,
    provider: input.provider,
    modelVersion: input.modelVersion,
    decisionReason: explainAgeDecision(input.result, input.cfg, input.status),
    createdAt: input.now,
  };
}
