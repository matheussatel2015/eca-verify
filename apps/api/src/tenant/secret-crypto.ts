import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

// Token format: base64(iv).base64(tag).base64(ciphertext)
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${ct.toString('base64')}`;
}

export function decryptSecret(token: string, key: Buffer): string {
  const [ivB64, tagB64, ctB64] = token.split('.');
  if (!ivB64 || !tagB64 || !ctB64) throw new Error('decryptSecret: malformed token');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}
