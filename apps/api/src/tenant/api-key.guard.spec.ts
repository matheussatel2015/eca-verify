import { hashApiKey, extractBearer } from './api-key.guard';

test('extractBearer pulls the token out of the header', () => {
  expect(extractBearer('Bearer sk_abc')).toBe('sk_abc');
});

test('extractBearer returns null without the scheme', () => {
  expect(extractBearer('sk_abc')).toBeNull();
});

test('hashApiKey is deterministic sha256 hex', () => {
  expect(hashApiKey('sk_abc')).toBe(hashApiKey('sk_abc'));
  expect(hashApiKey('sk_abc')).toHaveLength(64);
});
