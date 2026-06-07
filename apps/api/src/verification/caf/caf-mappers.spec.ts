import { extractAgeLiveness, isTransactionComplete, extractDocument } from './caf-mappers';

const tx = {
  status: 'COMPLETED',
  services: [
    { name: 'face_liveness', status: 'COMPLETED', data: { info: { probability: 95, openEyesProbability: 99 } } },
    { name: 'face_details', status: 'COMPLETED', data: { ageRangeLow: 17, ageRangeHigh: 21 } },
  ],
};

test('extracts liveness score (normalized) and the conservative low age', () => {
  const r = extractAgeLiveness(tx, 100);
  expect(r.livenessScore).toBeCloseTo(0.95);
  expect(r.estimatedAge).toBe(17); // use ageRangeLow — conservative for the cutoff
});

test('throws if a required service is missing', () => {
  expect(() => extractAgeLiveness({ status: 'COMPLETED', services: [] }, 100)).toThrow(/face/i);
});

test('isTransactionComplete is true only when all services are COMPLETED', () => {
  expect(isTransactionComplete(tx)).toBe(true);
  expect(isTransactionComplete({ status: 'PENDING', services: [{ name: 'x', status: 'PENDING', data: {} }] })).toBe(false);
});

test('extracts document birthDate + facematch from a transaction', () => {
  const tx = { status: 'COMPLETED', services: [
    { name: 'ocr', status: 'COMPLETED', data: { ocr: { birthDate: '1999-03-02', name: 'Maria' } } },
    { name: 'facematch', status: 'COMPLETED', data: { confidence: 92, identical: true } },
  ]};
  expect(extractDocument(tx, 100)).toEqual({ birthDate: '1999-03-02', faceMatchScore: 0.92, identical: true });
});
