import { maskIp } from './ip-mask.util';

test('masks the last octet of an IPv4 address', () => {
  expect(maskIp('200.158.4.27')).toBe('200.158.4.0');
});

test('masks the host half of an IPv6 address', () => {
  expect(maskIp('2001:db8:85a3:1:2:3:4:5')).toBe('2001:db8:85a3:1::');
});

test('returns unknown for empty input', () => {
  expect(maskIp('')).toBe('unknown');
});
