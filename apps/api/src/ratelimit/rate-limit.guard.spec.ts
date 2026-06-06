import { rateLimitKey } from './rate-limit.guard';

test('derives a per-minute redis key from the api key hash', () => {
  expect(rateLimitKey('abc123', '2026-06-06T12:34')).toBe('rl:abc123:2026-06-06T12:34');
});

test('different minutes produce different buckets', () => {
  expect(rateLimitKey('abc', '2026-06-06T12:34')).not.toBe(rateLimitKey('abc', '2026-06-06T12:35'));
});
