import { ageFromBirthDate, decideDocument } from './document-decision';

test('computes age from an ISO birth date', () => {
  expect(ageFromBirthDate('2000-06-06', new Date('2026-06-06'))).toBe(26);
  expect(ageFromBirthDate('2000-06-07', new Date('2026-06-06'))).toBe(25); // birthday not yet reached
});

test('approves when faces match and the document age is >= cutoff', () => {
  expect(decideDocument({ ageFromDoc: 20, faceMatchScore: 0.9, identical: true }, 18)).toBe('aprovado');
});

test('reprova when faces do not match', () => {
  expect(decideDocument({ ageFromDoc: 40, faceMatchScore: 0.2, identical: false }, 18)).toBe('reprovado');
});

test('reprova when underage even if faces match', () => {
  expect(decideDocument({ ageFromDoc: 16, faceMatchScore: 0.95, identical: true }, 18)).toBe('reprovado');
});

test('reprova when the document age is unknown', () => {
  expect(decideDocument({ ageFromDoc: null, faceMatchScore: 0.95, identical: true }, 18)).toBe('reprovado');
});

test('reprova when identical but face-match score is below the threshold', () => {
  expect(decideDocument({ ageFromDoc: 30, faceMatchScore: 0.2, identical: true }, 18)).toBe('reprovado');
});
