import { buildDocumentRecord } from './document-record-builder';

test('builds a document-method record without biometrics', () => {
  const rec = buildDocumentRecord({
    transactionId: 'tx2', tenantId: 'ten1', status: 'aprovado',
    ageFromDoc: 22, faceMatchScore: 0.95, cutoffAge: 18, provider: 'mock', modelVersion: 'mock-1',
    now: new Date('2026-06-07T00:00:00Z'),
  });
  expect(rec).toMatchObject({ id: 'tx2', tenantId: 'ten1', status: 'aprovado', isOver18: true, method: 'document', estimatedAge: 22, cutoffAge: 18, provider: 'mock' });
  expect(rec.decisionReason).toMatch(/documento|facematch|0\.95/i);
});
