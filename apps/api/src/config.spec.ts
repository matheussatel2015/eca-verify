import { loadDecisionConfig } from './config';

test('reads decision config from env with defaults', () => {
  const cfg = loadDecisionConfig({ CUTOFF_AGE: '18', DECISION_MARGIN: '3', LIVENESS_THRESHOLD: '0.8' });
  expect(cfg).toEqual({ cutoffAge: 18, margin: 3, livenessThreshold: 0.8 });
});

test('falls back to defaults when env is absent', () => {
  const cfg = loadDecisionConfig({});
  expect(cfg).toEqual({ cutoffAge: 18, margin: 3, livenessThreshold: 0.8 });
});
