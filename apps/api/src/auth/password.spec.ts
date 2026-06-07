import { hashPassword, verifyPassword } from './password';

test('hash is salted (not the plaintext) and verifies', () => {
  const h = hashPassword('s3nha-forte');
  expect(h).not.toContain('s3nha-forte');
  expect(h).toContain(':');
  expect(verifyPassword('s3nha-forte', h)).toBe(true);
});

test('verify rejects the wrong password', () => {
  expect(verifyPassword('errada', hashPassword('certa'))).toBe(false);
});

test('two hashes of the same password differ (random salt)', () => {
  expect(hashPassword('x')).not.toBe(hashPassword('x'));
});

test('verify is false for a malformed stored value', () => {
  expect(verifyPassword('x', 'garbage')).toBe(false);
});
