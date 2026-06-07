import { CafDocumentVerifier } from './caf-document-verifier';

test('creates an ocr+facematch transaction and maps the result', async () => {
  const client = {
    createTransaction: jest.fn(async (_payload: unknown) => ({ id: 'txd' })),
    awaitTransaction: jest.fn(async (_id: string) => ({ status: 'COMPLETED', services: [
      { name: 'ocr', status: 'COMPLETED', data: { ocr: { birthDate: '2001-05-05' } } },
      { name: 'facematch', status: 'COMPLETED', data: { confidence: 80, identical: true } },
    ]})),
  };
  const v = new CafDocumentVerifier(client as any, 100);
  const r = await v.verify({ documentImage: Buffer.from('doc'), selfieImage: Buffer.from('self') });
  expect(r).toEqual({ birthDate: '2001-05-05', faceMatchScore: 0.8, identical: true });
  const payload = JSON.stringify(client.createTransaction.mock.calls[0][0]);
  expect(payload).toContain(Buffer.from('doc').toString('base64'));
  expect(payload).toContain(Buffer.from('self').toString('base64'));
});
