import { loadDecisionConfig, loadProviderConfig } from './config';

test('reads decision config from env with defaults', () => {
  const cfg = loadDecisionConfig({ CUTOFF_AGE: '18', DECISION_MARGIN: '3', LIVENESS_THRESHOLD: '0.8' });
  expect(cfg).toEqual({ cutoffAge: 18, margin: 3, livenessThreshold: 0.8 });
});

test('falls back to defaults when env is absent', () => {
  const cfg = loadDecisionConfig({});
  expect(cfg).toEqual({ cutoffAge: 18, margin: 3, livenessThreshold: 0.8 });
});

test('defaults both providers to mock when unset', () => {
  expect(loadProviderConfig({})).toMatchObject({ ageKind: 'mock', docKind: 'mock' });
});

test('reads caf settings from env', () => {
  const cfg = loadProviderConfig({
    AGE_PROVIDER_KIND: 'caf', DOC_VERIFIER_KIND: 'caf',
    CAF_BASE_URL: 'https://api.us.prd.caf.io', CAF_CLIENT_ID: 'id', CAF_CLIENT_SECRET: 'sec',
    CAF_SCORE_SCALE: '100', CAF_TIMEOUT_MS: '8000', CAF_POLL_INTERVAL_MS: '500', CAF_POLL_MAX_ATTEMPTS: '20',
  });
  expect(cfg).toEqual({
    ageKind: 'caf', docKind: 'caf',
    caf: { baseUrl: 'https://api.us.prd.caf.io', clientId: 'id', clientSecret: 'sec',
           scoreScale: 100, timeoutMs: 8000, pollIntervalMs: 500, pollMaxAttempts: 20 },
  });
});
