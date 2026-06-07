import { decideVerification } from './decision';
import { AgeProviderResult, DecisionConfig } from '@eca/sdk-types';

const cfg: DecisionConfig = { cutoffAge: 18, margin: 3, livenessThreshold: 0.8 };

function result(estimatedAge: number, livenessScore: number): AgeProviderResult {
  return { estimatedAge, livenessScore };
}

describe('decideVerification boundaries', () => {
  test('age exactly cutoff+margin (21) is aprovado (rule: >= cutoff+margin)', () => {
    expect(decideVerification(result(21, 0.9), cfg)).toBe('aprovado');
  });

  test('age exactly cutoff-margin (15) is documento_requerido (rule: reprovado only when < cutoff-margin)', () => {
    expect(decideVerification(result(15, 0.9), cfg)).toBe('documento_requerido');
  });

  test('livenessScore exactly at threshold (0.8) is NOT reprovado for liveness (rule: < threshold)', () => {
    // 0.8 is not < 0.8, so it falls through liveness; age 15 -> documento_requerido (not reprovado-for-liveness)
    expect(decideVerification(result(15, 0.8), cfg)).not.toBe('reprovado');
    expect(decideVerification(result(15, 0.8), cfg)).toBe('documento_requerido');
  });

  test('livenessScore 0.79 is reprovado (below threshold)', () => {
    expect(decideVerification(result(21, 0.79), cfg)).toBe('reprovado');
  });
});
