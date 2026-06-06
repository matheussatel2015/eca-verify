import { EncryptedFrame } from '../verification/crypto.util';

export function serializeFrame(frame: EncryptedFrame): Buffer {
  const json = JSON.stringify({
    iv: frame.iv.toString('base64'),
    tag: frame.tag.toString('base64'),
    ciphertext: frame.ciphertext.toString('base64'),
  });
  return Buffer.from(json, 'utf8');
}

export function deserializeFrame(bytes: Buffer): EncryptedFrame {
  const obj = JSON.parse(bytes.toString('utf8')) as { iv: string; tag: string; ciphertext: string };
  return {
    iv: Buffer.from(obj.iv, 'base64'),
    tag: Buffer.from(obj.tag, 'base64'),
    ciphertext: Buffer.from(obj.ciphertext, 'base64'),
  };
}
