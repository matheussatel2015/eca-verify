import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';

const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const dk = scryptSync(password, salt, KEYLEN);
  return `${salt.toString('hex')}:${dk.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = (stored ?? '').split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== KEYLEN) return false;
  const dk = scryptSync(password, Buffer.from(saltHex, 'hex'), KEYLEN);
  return timingSafeEqual(expected, dk);
}
