import { looksLikeJwt } from './dashboard-auth.guard';

test('looksLikeJwt true for a 3-part token', () => {
  expect(looksLikeJwt('aaa.bbb.ccc')).toBe(true);
});

test('looksLikeJwt false for an sk_ api key', () => {
  expect(looksLikeJwt('sk_abc123')).toBe(false);
});

test('looksLikeJwt false for empty/garbage', () => {
  expect(looksLikeJwt('')).toBe(false);
  expect(looksLikeJwt('aaa.bbb')).toBe(false);
});
