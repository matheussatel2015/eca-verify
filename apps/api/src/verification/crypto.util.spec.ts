import { encryptFrame, decryptFrame, zero } from './crypto.util';

const key = Buffer.alloc(32, 7); // 256-bit test key

test('decrypt recovers the original plaintext', () => {
  const plain = Buffer.from('frame-bytes');
  const enc = encryptFrame(plain, key);
  const dec = decryptFrame(enc, key);
  expect(dec.toString()).toBe('frame-bytes');
});

test('zero wipes a buffer in place', () => {
  const b = Buffer.from('secret');
  zero(b);
  expect(b.every((byte) => byte === 0)).toBe(true);
});

test('tampered ciphertext fails authentication', () => {
  const enc = encryptFrame(Buffer.from('x'), key);
  enc.ciphertext[0] ^= 0xff;
  expect(() => decryptFrame(enc, key)).toThrow();
});
