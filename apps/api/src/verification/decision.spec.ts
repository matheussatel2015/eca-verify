import { decideVerification, isOver18 } from './decision';
import { DecisionConfig } from '@eca/sdk-types';

const cfg: DecisionConfig = { cutoffAge: 18, margin: 3, livenessThreshold: 0.8 };

test('low liveness is always reprovado', () => {
  expect(decideVerification({ estimatedAge: 40, livenessScore: 0.5 }, cfg)).toBe('reprovado');
});

test('clearly above cutoff is aprovado', () => {
  expect(decideVerification({ estimatedAge: 25, livenessScore: 0.9 }, cfg)).toBe('aprovado');
});

test('clearly below cutoff is reprovado', () => {
  expect(decideVerification({ estimatedAge: 13, livenessScore: 0.9 }, cfg)).toBe('reprovado');
});

test('grey zone requires document', () => {
  expect(decideVerification({ estimatedAge: 19, livenessScore: 0.9 }, cfg)).toBe('documento_requerido');
});

test('is_over_18 is true only for aprovado', () => {
  expect(isOver18('aprovado')).toBe(true);
  expect(isOver18('documento_requerido')).toBe(false);
  expect(isOver18('reprovado')).toBe(false);
});
