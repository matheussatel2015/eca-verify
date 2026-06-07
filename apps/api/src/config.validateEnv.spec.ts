import { validateEnv } from './config';

const VALID_KEY = 'a'.repeat(64);

function validEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/eca',
    APP_ENCRYPTION_KEY: VALID_KEY,
    CUTOFF_AGE: '18',
    DECISION_MARGIN: '3',
    LIVENESS_THRESHOLD: '0.8',
    RATE_LIMIT_PER_MIN: '60',
    FRAME_TTL_SECONDS: '300',
    SESSION_TTL_SECONDS: '900',
    ...overrides,
  };
}

test('accepts a fully valid env without throwing', () => {
  expect(() => validateEnv(validEnv())).not.toThrow();
});

test('uses defaults for absent numeric vars', () => {
  const env = validEnv();
  delete env.CUTOFF_AGE;
  delete env.RATE_LIMIT_PER_MIN;
  expect(() => validateEnv(env)).not.toThrow();
});

test('throws when DATABASE_URL is missing', () => {
  const env = validEnv();
  delete env.DATABASE_URL;
  expect(() => validateEnv(env)).toThrow(/DATABASE_URL/);
});

test('throws when APP_ENCRYPTION_KEY has wrong length', () => {
  expect(() => validateEnv(validEnv({ APP_ENCRYPTION_KEY: 'abc' }))).toThrow(/APP_ENCRYPTION_KEY/);
});

test('throws when a numeric var is not a finite number', () => {
  expect(() => validateEnv(validEnv({ CUTOFF_AGE: 'not-a-number' }))).toThrow(/CUTOFF_AGE/);
});

test('throws when caf age provider is selected without credentials', () => {
  expect(() => validateEnv(validEnv({ AGE_PROVIDER_KIND: 'caf' }))).toThrow(/CAF_/);
});

test('throws when caf doc verifier is selected without credentials', () => {
  expect(() => validateEnv(validEnv({ DOC_VERIFIER_KIND: 'caf' }))).toThrow(/CAF_/);
});

test('accepts caf kind when all credentials are present', () => {
  const env = validEnv({
    AGE_PROVIDER_KIND: 'caf',
    DOC_VERIFIER_KIND: 'caf',
    CAF_BASE_URL: 'https://api.us.prd.caf.io',
    CAF_CLIENT_ID: 'id',
    CAF_CLIENT_SECRET: 'sec',
  });
  expect(() => validateEnv(env)).not.toThrow();
});

test('throws when stripe payment provider is selected without keys', () => {
  expect(() => validateEnv(validEnv({ PAYMENT_PROVIDER_KIND: 'stripe' }))).toThrow(/STRIPE_/);
});

test('accepts stripe payment provider when all keys are present', () => {
  const env = validEnv({
    PAYMENT_PROVIDER_KIND: 'stripe',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    STRIPE_PRICE_PRO: 'price_pro',
    STRIPE_PRICE_SCALE: 'price_scale',
  });
  expect(() => validateEnv(env)).not.toThrow();
});
