import dns from 'dns';

export type WebhookUrlCheck = { ok: true } | { ok: false; reason: string };

type UnsafeCheck = { unsafe: true; reason: string } | { unsafe: false };

/**
 * Checks an IPv4 dotted-quad string against private, loopback, link-local,
 * CGNAT, benchmarking, multicast and reserved ranges (SSRF protection).
 */
function isUnsafeIPv4(ip: string): UnsafeCheck {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return { unsafe: false };
  const [a, b, c] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (a === 10) return { unsafe: true, reason: 'Private 10.0.0.0/8 not allowed' };
  if (a === 127) return { unsafe: true, reason: 'Loopback 127.0.0.0/8 not allowed' };
  if (a === 169 && b === 254) return { unsafe: true, reason: 'Link-local 169.254.0.0/16 not allowed' };
  if (a === 172 && b >= 16 && b <= 31) return { unsafe: true, reason: 'Private 172.16.0.0/12 not allowed' };
  if (a === 192 && b === 168) return { unsafe: true, reason: 'Private 192.168.0.0/16 not allowed' };
  if (a === 0) return { unsafe: true, reason: 'Reserved 0.0.0.0/8 not allowed' };
  if (a === 100 && b >= 64 && b <= 127) return { unsafe: true, reason: 'Shared address space 100.64.0.0/10 not allowed' };
  if (a === 192 && b === 0 && c === 0) return { unsafe: true, reason: 'IETF protocol assignments 192.0.0.0/24 not allowed' };
  if (a === 198 && (b === 18 || b === 19)) return { unsafe: true, reason: 'Benchmarking 198.18.0.0/15 not allowed' };
  if (a >= 224 && a <= 239) return { unsafe: true, reason: 'Multicast 224.0.0.0/4 not allowed' };
  if (a >= 240) return { unsafe: true, reason: 'Reserved 240.0.0.0/4 not allowed' };
  return { unsafe: false };
}

/**
 * Expands an IPv6 string (bracketless, optional zone id, optional embedded
 * dotted IPv4 tail) to its eight 16-bit groups. Returns null if malformed.
 */
function parseIPv6(ip: string): number[] | null {
  let addr = ip.toLowerCase().split('%')[0];
  const tail = addr.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (tail) {
    const o = tail[1].split('.').map(Number);
    if (o.some((n) => n > 255)) return null;
    addr = addr.slice(0, -tail[1].length) + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  const nums = groups.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return nums.some(Number.isNaN) ? null : nums;
}

/**
 * Checks an IPv6 address (bracketless form). Handles IPv4-mapped
 * (::ffff:a.b.c.d / ::ffff:7f00:1) and IPv4-compatible (::a.b.c.d) forms by
 * re-checking the embedded IPv4 address. Unparseable input fails closed.
 */
function isUnsafeIPv6(ip: string): UnsafeCheck {
  const g = parseIPv6(ip);
  if (!g) return { unsafe: true, reason: 'Invalid IPv6 address' };
  const embeddedV4 = `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (g.slice(0, 5).every((n) => n === 0) && (g[5] === 0xffff || g[5] === 0)) {
    if (g.slice(0, 7).every((n) => n === 0) && g[7] === 1) return { unsafe: true, reason: 'IPv6 loopback ::1 not allowed' };
    if (g.every((n) => n === 0)) return { unsafe: true, reason: 'IPv6 unspecified :: not allowed' };
    const v4 = isUnsafeIPv4(embeddedV4);
    return v4.unsafe ? { unsafe: true, reason: `IPv4-embedded IPv6 address: ${v4.reason}` } : v4;
  }
  // Översättnings-/tunnelprefix bär en IPv4-adress som kan peka in i nätet: NAT64
  // (64:ff9b::/96, v4 i de sista 32 bitarna) och 6to4 (2002::/16, v4 i bit 16-47).
  // Alla nekas, och en inbäddad privat adress anges som orsak.
  const nat64 = g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((n) => n === 0);
  if (nat64 || g[0] === 0x2002) {
    const tunnelled = nat64 ? embeddedV4 : `${g[1] >> 8}.${g[1] & 255}.${g[2] >> 8}.${g[2] & 255}`;
    const v4 = isUnsafeIPv4(tunnelled);
    const prefix = nat64 ? 'NAT64 64:ff9b::/96' : '6to4 2002::/16';
    return { unsafe: true, reason: `${prefix} not allowed${v4.unsafe ? ` (embedded IPv4: ${v4.reason})` : ''}` };
  }
  if (g[0] === 0x2001 && g[1] === 0) return { unsafe: true, reason: 'IPv6 Teredo 2001::/32 not allowed' };
  if ((g[0] & 0xffc0) === 0xfec0) return { unsafe: true, reason: 'IPv6 site-local fec0::/10 not allowed' };
  if ((g[0] & 0xffc0) === 0xfe80) return { unsafe: true, reason: 'IPv6 link-local fe80::/10 not allowed' };
  if ((g[0] & 0xfe00) === 0xfc00) return { unsafe: true, reason: 'IPv6 unique-local fc00::/7 not allowed' };
  if ((g[0] & 0xff00) === 0xff00) return { unsafe: true, reason: 'IPv6 multicast ff00::/8 not allowed' };
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

  // Avslutande punkt ("localhost.") ska inte kringgå namnkontrollen.
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
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

export const VALID_WEBHOOK_EVENTS = [
  'ticket.created', 'ticket.updated', 'ticket.closed', 'ticket.deleted', 'ticket.status_changed',
  'comment.created', 'contact.created', 'contact.updated',
];

export type WebhookEventsCheck = { ok: true; events: string[] } | { ok: false; error: string };

/** Validerar events-listan (icke-tom array av kända event-namn) för POST och PUT. */
export function validateWebhookEvents(events: unknown): WebhookEventsCheck {
  if (!Array.isArray(events) || events.length === 0) {
    return { ok: false, error: 'At least one event is required' };
  }
  const invalid = events.filter((e) => typeof e !== 'string' || !VALID_WEBHOOK_EVENTS.includes(e));
  if (invalid.length > 0) {
    return { ok: false, error: `Invalid event type(s): ${invalid.map(String).join(', ')}` };
  }
  return { ok: true, events: [...new Set(events as string[])] };
}
