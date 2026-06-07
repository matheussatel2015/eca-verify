import { buildDocumentPayload } from './document';

test('packs both encrypted images with the document session token', () => {
  const img = { iv: Buffer.from([1]), tag: Buffer.from([2]), ciphertext: Buffer.from([3]) };
  const payload = buildDocumentPayload('doc-token', img, img);
  expect(payload.document_session_token).toBe('doc-token');
  expect(payload.document.iv).toBe(Buffer.from([1]).toString('base64'));
  expect(payload.selfie.ciphertext).toBe(Buffer.from([3]).toString('base64'));
});
