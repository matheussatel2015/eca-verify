/**
 * SSRF protection for tenant-supplied webhook URLs.
 *
 * This is a STATIC, hostname-based check: it parses the URL and rejects
 * non-http(s) schemes and hosts that match private / loopback / link-local
 * patterns. It does NOT resolve DNS, so it does not by itself defend against
 * DNS rebinding (a hostname that resolves to a public IP at validation time
 * but to 169.254.169.254 at request time). For full protection, the actual
 * webhook dispatcher should additionally resolve and re-check the IP at send
 * time (and/or pin to the resolved address). This guard is the first line.
 */

/** Strip an IPv6 zone id and surrounding brackets, lowercase the host. */
function normalizeHost(host: string): string {
  let h = host.trim().toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) {
    h = h.slice(1, -1);
  }
  const zone = h.indexOf('%');
  if (zone !== -1) {
    h = h.slice(0, zone);
  }
  return h;
}

/**
 * Returns true if the host points at a private, loopback, link-local or
 * unspecified target based on hostname/IP-literal pattern matching.
 */
export function isPrivateHost(host: string): boolean {
  const h = normalizeHost(host);
  if (!h) return true;

  if (h === 'localhost') return true;

  // IPv4 / IPv4-prefixed patterns
  if (h === '0.0.0.0') return true;
  if (h.startsWith('127.')) return true; // loopback
  if (h.startsWith('10.')) return true; // RFC1918
  if (h.startsWith('192.168.')) return true; // RFC1918
  if (h.startsWith('169.254.')) return true; // link-local (incl. cloud metadata)

  // 172.16.0.0 - 172.31.255.255 (RFC1918)
  const m172 = /^172\.(\d{1,3})\./.exec(h);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }

  // IPv6 loopback / unspecified
  if (h === '::1' || h === '::') return true;

  // IPv6 unique local addresses (ULA) fc00::/7 -> prefixes fc and fd
  if (h.startsWith('fc') || h.startsWith('fd')) return true;

  // IPv6 link-local fe80::/10
  if (h.startsWith('fe80')) return true;

  return false;
}

/**
 * Throws if the URL is not an http(s) URL pointing at a public host.
 * Caller is responsible for mapping the thrown Error to an HTTP 400.
 */
export function assertSafeWebhookUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('webhook_url must be a valid http(s) URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('webhook_url must use the http or https scheme');
  }

  if (isPrivateHost(url.hostname)) {
    throw new Error('webhook_url must not point at a private or loopback address');
  }
}
