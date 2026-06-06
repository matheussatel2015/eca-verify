import { VERIFICATION_STATUSES, isVerificationStatus } from './index';

test('aprovado is a valid status', () => {
  expect(isVerificationStatus('aprovado')).toBe(true);
});

test('garbage is not a valid status', () => {
  expect(isVerificationStatus('foo')).toBe(false);
});

test('there are exactly three statuses', () => {
  expect(VERIFICATION_STATUSES).toHaveLength(3);
});
