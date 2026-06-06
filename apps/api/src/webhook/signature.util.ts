import { createHmac, timingSafeEqual } from 'crypto';

export function signPayload(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function verifySignature(body: string, signature: string, secret: string): boolean {
  const expected = signPayload(body, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}
