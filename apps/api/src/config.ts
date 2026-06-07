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

const NUMERIC_ENV_VARS = [
  'CUTOFF_AGE',
  'DECISION_MARGIN',
  'LIVENESS_THRESHOLD',
  'RATE_LIMIT_PER_MIN',
  'FRAME_TTL_SECONDS',
  'SESSION_TTL_SECONDS',
] as const;

/**
 * Fail-fast validation of required environment variables at boot.
 * Throws an Error with a clear message describing the first problem found.
 */
export function validateEnv(env: NodeJS.ProcessEnv): void {
  if (!env.DATABASE_URL || env.DATABASE_URL.trim() === '') {
    throw new Error('DATABASE_URL is required');
  }

  const key = env.APP_ENCRYPTION_KEY ?? '';
  if (key.length !== 64 || !/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  }

  for (const name of NUMERIC_ENV_VARS) {
    const raw = env[name];
    if (raw === undefined) continue; // absent vars fall back to code defaults
    if (!Number.isFinite(Number(raw))) {
      throw new Error(`${name} must be a finite number (got "${raw}")`);
    }
  }

  const usesCaf = env.AGE_PROVIDER_KIND === 'caf' || env.DOC_VERIFIER_KIND === 'caf';
  if (usesCaf) {
    const missing = (['CAF_BASE_URL', 'CAF_CLIENT_ID', 'CAF_CLIENT_SECRET'] as const).filter(
      (name) => !env[name] || env[name]!.trim() === '',
    );
    if (missing.length > 0) {
      throw new Error(`CAF provider selected but missing credentials: ${missing.join(', ')}`);
    }
  }
}
