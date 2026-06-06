import { DecisionConfig } from '@eca/sdk-types';

export function loadDecisionConfig(env: NodeJS.ProcessEnv): DecisionConfig {
  return {
    cutoffAge: Number(env.CUTOFF_AGE ?? 18),
    margin: Number(env.DECISION_MARGIN ?? 3),
    livenessThreshold: Number(env.LIVENESS_THRESHOLD ?? 0.8),
  };
}

export function encryptionKey(env: NodeJS.ProcessEnv): Buffer {
  const hex = env.APP_ENCRYPTION_KEY ?? '';
  if (hex.length !== 64) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  return Buffer.from(hex, 'hex');
}
