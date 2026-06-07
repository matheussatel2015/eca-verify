import { assertSafeWebhookUrl, isPrivateHost } from './url-safety';

describe('assertSafeWebhookUrl', () => {
  test('accepts a public https URL', () => {
    expect(() => assertSafeWebhookUrl('https://acme.com/hook')).not.toThrow();
  });

  test('rejects loopback hostname (localhost)', () => {
    expect(() => assertSafeWebhookUrl('http://localhost/x')).toThrow();
  });

  test('rejects link-local metadata address (169.254.x)', () => {
    expect(() => assertSafeWebhookUrl('http://169.254.169.254/')).toThrow();
  });

  test('rejects private RFC1918 address (10.x)', () => {
    expect(() => assertSafeWebhookUrl('http://10.0.0.1/')).toThrow();
  });

  test('rejects non-http(s) scheme (ftp)', () => {
    expect(() => assertSafeWebhookUrl('ftp://x')).toThrow();
  });
});

describe('isPrivateHost', () => {
  test('public hostnames are not private', () => {
    expect(isPrivateHost('acme.com')).toBe(false);
    expect(isPrivateHost('8.8.8.8')).toBe(false);
  });

  test('loopback and unspecified are private', () => {
    expect(isPrivateHost('localhost')).toBe(true);
    expect(isPrivateHost('127.0.0.1')).toBe(true);
    expect(isPrivateHost('0.0.0.0')).toBe(true);
    expect(isPrivateHost('::1')).toBe(true);
  });

  test('RFC1918 ranges are private', () => {
    expect(isPrivateHost('10.255.0.1')).toBe(true);
    expect(isPrivateHost('192.168.1.1')).toBe(true);
    expect(isPrivateHost('172.16.0.1')).toBe(true);
    expect(isPrivateHost('172.31.255.255')).toBe(true);
  });

  test('172.x outside 16-31 is public', () => {
    expect(isPrivateHost('172.15.0.1')).toBe(false);
    expect(isPrivateHost('172.32.0.1')).toBe(false);
  });

  test('link-local IPv4 and IPv6 ULA are private', () => {
    expect(isPrivateHost('169.254.169.254')).toBe(true);
    expect(isPrivateHost('fc00::1')).toBe(true);
    expect(isPrivateHost('fd12:3456::1')).toBe(true);
  });
});
