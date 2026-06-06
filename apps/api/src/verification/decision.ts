import { AgeProviderResult, DecisionConfig, VerificationStatus } from '@eca/sdk-types';

export function decideVerification(result: AgeProviderResult, cfg: DecisionConfig): VerificationStatus {
  if (result.livenessScore < cfg.livenessThreshold) return 'reprovado';
  if (result.estimatedAge >= cfg.cutoffAge + cfg.margin) return 'aprovado';
  if (result.estimatedAge < cfg.cutoffAge - cfg.margin) return 'reprovado';
  return 'documento_requerido';
}

export function isOver18(status: VerificationStatus): boolean {
  return status === 'aprovado';
}
