import { createHmac, timingSafeEqual } from 'crypto';

export function signPayload(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function verifySignature(body: string, signature: string, secret: string): boolean {
  // HMAC both sides again so the comparison is always over equal-length digests (no length oracle).
  const expected = Buffer.from(signPayload(signPayload(body, secret), secret));
  const provided = Buffer.from(signPayload(signature, secret));
  return timingSafeEqual(expected, provided);
}
