import { DecisionConfig } from '@eca/sdk-types';

export function loadDecisionConfig(env: NodeJS.ProcessEnv): DecisionConfig {
  return {
    cutoffAge: Number(env.CUTOFF_AGE ?? 18),
    margin: Number(env.DECISION_MARGIN ?? 3),
    livenessThreshold: Number(env.LIVENESS_THRESHOLD ?? 0.8),
  };
}

export type ProviderKind = 'mock' | 'caf';

export interface CafConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  scoreScale: number;
  timeoutMs: number;
  pollIntervalMs: number;
  pollMaxAttempts: number;
}

export interface ProviderConfig {
  ageKind: ProviderKind;
  docKind: ProviderKind;
  caf?: CafConfig;
}

export function loadProviderConfig(env: NodeJS.ProcessEnv): ProviderConfig {
  const ageKind = (env.AGE_PROVIDER_KIND ?? 'mock') as ProviderKind;
  const docKind = (env.DOC_VERIFIER_KIND ?? 'mock') as ProviderKind;
  const cfg: ProviderConfig = { ageKind, docKind };
  if (ageKind === 'caf' || docKind === 'caf') {
    cfg.caf = {
      baseUrl: env.CAF_BASE_URL ?? '',
      clientId: env.CAF_CLIENT_ID ?? '',
      clientSecret: env.CAF_CLIENT_SECRET ?? '',
      scoreScale: Number(env.CAF_SCORE_SCALE ?? 100),
      timeoutMs: Number(env.CAF_TIMEOUT_MS ?? 8000),
      pollIntervalMs: Number(env.CAF_POLL_INTERVAL_MS ?? 500),
      pollMaxAttempts: Number(env.CAF_POLL_MAX_ATTEMPTS ?? 20),
    };
  }
  return cfg;
}

export function encryptionKey(env: NodeJS.ProcessEnv): Buffer {
  const hex = env.APP_ENCRYPTION_KEY ?? '';
  if (hex.length !== 64) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  return Buffer.from(hex, 'hex');
}
