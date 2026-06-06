import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export interface EncryptedFrame {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

export function encryptFrame(plain: Buffer, key: Buffer): EncryptedFrame {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

export function decryptFrame(enc: EncryptedFrame, key: Buffer): Buffer {
  const decipher = createDecipheriv('aes-256-gcm', key, enc.iv);
  decipher.setAuthTag(enc.tag);
  return Buffer.concat([decipher.update(enc.ciphertext), decipher.final()]);
}

/** Overwrite a buffer's bytes with zero, in place. */
export function zero(buf: Buffer): void {
  buf.fill(0);
}
