import { MockDocumentVerifier } from './mock-document-verifier';

test('mock returns the configured document result', async () => {
  const v = new MockDocumentVerifier({ birthDate: '2000-01-01', faceMatchScore: 0.9, identical: true });
  const r = await v.verify({ documentImage: Buffer.from('d'), selfieImage: Buffer.from('s') });
  expect(r).toEqual({ birthDate: '2000-01-01', faceMatchScore: 0.9, identical: true });
});
