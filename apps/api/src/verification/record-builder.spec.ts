import { explainAgeDecision, buildAgeRecord } from './record-builder';
import { DecisionConfig } from '@eca/sdk-types';

const cfg: DecisionConfig = { cutoffAge: 18, margin: 3, livenessThreshold: 0.8 };

test('explains a low-liveness rejection', () => {
  expect(explainAgeDecision({ estimatedAge: 40, livenessScore: 0.5 }, cfg, 'reprovado'))
    .toMatch(/liveness 0\.5 .* 0\.8/);
});

test('explains an approval by age margin', () => {
  expect(explainAgeDecision({ estimatedAge: 25, livenessScore: 0.9 }, cfg, 'aprovado'))
    .toMatch(/25 .* 21/); // cutoff+margin
});

test('explains a low-age rejection', () => {
  expect(explainAgeDecision({ estimatedAge: 10, livenessScore: 0.9 }, cfg, 'reprovado')).toMatch(/10 .*15/);
});

test('explains a grey-zone document requirement', () => {
  expect(explainAgeDecision({ estimatedAge: 19, livenessScore: 0.9 }, cfg, 'documento_requerido'))
    .toMatch(/zona cinzenta|grey/i);
});

test('buildAgeRecord assembles persistable metadata without biometrics', () => {
  const rec = buildAgeRecord({
    transactionId: 'tx1', tenantId: 'ten1',
    result: { estimatedAge: 25, livenessScore: 0.9 }, cfg, status: 'aprovado',
    provider: 'mock', modelVersion: 'mock-1', now: new Date('2026-06-07T00:00:00Z'),
  });
  expect(rec).toMatchObject({
    id: 'tx1', tenantId: 'ten1', status: 'aprovado', isOver18: true, method: 'age_liveness',
    estimatedAge: 25, livenessScore: 0.9, cutoffAge: 18, margin: 3, livenessThreshold: 0.8,
    provider: 'mock', modelVersion: 'mock-1',
  });
  expect(typeof rec.decisionReason).toBe('string');
  expect(Object.keys(rec)).not.toContain('frame');
});
