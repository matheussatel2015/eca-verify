// E2E helper: encrypt a dummy frame with AES-256-GCM using APP_ENCRYPTION_KEY,
// so the backend (which decrypts with the same key) can process it.
// Prints a JSON frame object: { iv, tag, ciphertext } (all base64).
//
// Usage: APP_ENCRYPTION_KEY=<64hex> npx ts-node apps/api/scripts/e2e-verify.ts
import { createCipheriv, randomBytes } from 'crypto';

function main(): void {
  const hex = process.env.APP_ENCRYPTION_KEY ?? '';
  if (hex.length !== 64) {
    throw new Error('APP_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
  }
  const key = Buffer.from(hex, 'hex');
  // Dummy frame payload — the mock provider does not inspect pixel content.
  const plain = Buffer.from('dummy-frame-bytes-for-e2e-smoke', 'utf8');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const frame = {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  process.stdout.write(JSON.stringify(frame));
}

main();
