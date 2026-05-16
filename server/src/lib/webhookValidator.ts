import dns from 'dns';

export type WebhookUrlCheck = { ok: true } | { ok: false; reason: string };

/**
 * Returns true if an IPv4 dotted-quad string sits in a private, loopback,
 * link-local, or otherwise non-publicly-routable range that we want to block
 * for SSRF protection.
 */
function isUnsafeIPv4(ip: string): { unsafe: true; reason: string } | { unsafe: false } {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return { unsafe: false };
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return { unsafe: true, reason: 'Private 10.0.0.0/8 not allowed' };
  if (a === 127) return { unsafe: true, reason: 'Loopback 127.0.0.0/8 not allowed' };
  if (a === 169 && b === 254) return { unsafe: true, reason: 'Link-local 169.254.0.0/16 not allowed' };
  if (a === 172 && b >= 16 && b <= 31) return { unsafe: true, reason: 'Private 172.16.0.0/12 not allowed' };
  if (a === 192 && b === 168) return { unsafe: true, reason: 'Private 192.168.0.0/16 not allowed' };
  if (a === 0) return { unsafe: true, reason: 'Reserved 0.0.0.0/8 not allowed' };
  return { unsafe: false };
}

/**
 * Returns true if an IPv6 address falls in loopback, link-local, or
 * unique-local ranges. Input is the bracketless string form (e.g. '::1',
 * 'fe80::1', 'fd12:3456:789a::1').
 */
function isUnsafeIPv6(ip: string): { unsafe: true; reason: string } | { unsafe: false } {
  const lower = ip.toLowerCase();
  if (lower === '::1') return { unsafe: true, reason: 'IPv6 loopback ::1 not allowed' };
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) {
    return { unsafe: true, reason: 'IPv6 link-local fe80::/10 not allowed' };
  }
  // fc00::/7 unique-local: first byte 0xfc or 0xfd
  if (lower.startsWith('fc') || lower.startsWith('fd')) {
    return { unsafe: true, reason: 'IPv6 unique-local fc00::/7 not allowed' };
  }
  return { unsafe: false };
}

/**
 * Validates that a webhook URL points to a public HTTPS endpoint.
 * Blocks SSRF vectors:
 *   - non-https protocols
 *   - hostname-string matches for localhost/loopback
 *   - literal IPv4/IPv6 in private/loopback/link-local ranges
 *   - hostnames whose DNS A/AAAA records resolve into those same ranges
 *     (catches dns-rebind and "evil.com -> 10.x.x.x" tricks)
 *
 * Async: performs a DNS lookup via `dns.promises.lookup`. All callers must await.
 */
export async function isSafeWebhookUrl(raw: string): Promise<WebhookUrlCheck> {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'Invalid URL' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'Only https:// URLs are allowed' };

  const host = parsed.hostname.toLowerCase();
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return { ok: false, reason: 'Loopback/local hosts are not allowed' };
  }

  // Block raw IPv4 literal in private/loopback/link-local ranges
  const v4Check = isUnsafeIPv4(host);
  if (v4Check.unsafe) return { ok: false, reason: v4Check.reason };

  // Block IPv6 literal — URL hostname is wrapped in [...] for v6
  if (host.startsWith('[') && host.endsWith(']')) {
    const v6 = host.slice(1, -1);
    const v6Check = isUnsafeIPv6(v6);
    if (v6Check.unsafe) return { ok: false, reason: v6Check.reason };
  }

  // DNS-resolve hostname and verify EVERY resolved address is publicly routable.
  // Skip lookup for IP literals — they were already validated above.
  const isLiteralV4 = /^(\d{1,3}\.){3}\d{1,3}$/.test(host);
  const isLiteralV6 = host.startsWith('[') && host.endsWith(']');
  if (!isLiteralV4 && !isLiteralV6) {
    let addrs: dns.LookupAddress[];
    try {
      addrs = await dns.promises.lookup(host, { all: true });
    } catch {
      return { ok: false, reason: 'DNS lookup failed' };
    }
    for (const a of addrs) {
      if (a.family === 4) {
        const v4 = isUnsafeIPv4(a.address);
        if (v4.unsafe) {
          return { ok: false, reason: `Resolved to private/loopback address: ${v4.reason}` };
        }
      } else if (a.family === 6) {
        const v6 = isUnsafeIPv6(a.address);
        if (v6.unsafe) {
          return { ok: false, reason: `Resolved to private/loopback address: ${v6.reason}` };
        }
      }
    }
  }

  return { ok: true };
}
