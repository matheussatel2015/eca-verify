export function maskIp(ip: string): string {
  if (!ip) return 'unknown';
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return parts.slice(0, 4).join(':') + '::';
  }
  const octets = ip.split('.');
  if (octets.length !== 4) return 'unknown';
  octets[3] = '0';
  return octets.join('.');
}
