import { RawEncryptedFrame } from './payload';

export function buildDocumentPayload(token: string, document: RawEncryptedFrame, selfie: RawEncryptedFrame) {
  const enc = (f: RawEncryptedFrame) => ({
    iv: f.iv.toString('base64'),
    tag: f.tag.toString('base64'),
    ciphertext: f.ciphertext.toString('base64'),
  });
  return { document_session_token: token, document: enc(document), selfie: enc(selfie) };
}
