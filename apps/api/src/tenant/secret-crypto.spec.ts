import { encryptSecret, decryptSecret } from './secret-crypto';

const key = Buffer.alloc(32, 9); // 256-bit test key

test('round-trips a secret through encrypt/decrypt', () => {
  const token = encryptSecret('whsec_abc123', key);
  expect(token).not.toContain('whsec_abc123'); // ciphertext, not plaintext
  expect(decryptSecret(token, key)).toBe('whsec_abc123');
});

test('produces a different ciphertext each time (random iv)', () => {
  expect(encryptSecret('same', key)).not.toBe(encryptSecret('same', key));
});

test('tampered token fails authentication', () => {
  const token = encryptSecret('x', key);
  const parts = token.split('.');
  const badCt = Buffer.from(parts[2], 'base64');
  badCt[0] ^= 0xff;
  const tampered = `${parts[0]}.${parts[1]}.${badCt.toString('base64')}`;
  expect(() => decryptSecret(tampered, key)).toThrow();
});
