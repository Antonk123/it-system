import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Unit tests for isSafeWebhookUrl() (server/src/lib/webhookValidator.ts).
 *
 * Audit finding H8: the DNS-rebind branch (lines ~78-102 — the block that
 * calls `dns.promises.lookup` and rejects a hostname if ANY resolved address
 * lands in a private/loopback/link-local/ULA range) had zero test coverage.
 * webhooks.test.ts intentionally only ever exercises PUBLIC IP LITERALS to
 * avoid real DNS, so the rebind guard itself — the actual "evil.com ->
 * 10.x.x.x" protection — was never proven to work.
 *
 * This file mocks `dns.promises.lookup` so every DNS-dependent path can be
 * driven deterministically with no real network access, and separately
 * covers the literal-IP fast paths (which must NOT call DNS at all) plus
 * scheme/host format handling.
 *
 * The source does `import dns from 'dns'` (default import) and calls
 * `dns.promises.lookup(...)`, so the mock factory below supplies a `default`
 * export shaped `{ promises: { lookup } }`. `lookupMock` is created via
 * `vi.hoisted` so it exists before the mocked module is evaluated and so
 * this test file can configure/assert on it directly.
 *
 * Module mocks in vitest are scoped per test file (separate module registry
 * per file), so this dns mock cannot leak into src/routes/webhooks.test.ts —
 * verified by running both files together (see verification note in the
 * task; not re-asserted here).
 */

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock('dns', () => ({
  default: { promises: { lookup: lookupMock } },
}));

import { isSafeWebhookUrl, validateWebhookEvents } from './webhookValidator.js';

beforeEach(() => {
  lookupMock.mockReset();
});

describe('isSafeWebhookUrl — IP literals (must NOT trigger a DNS lookup)', () => {
  it.each([
    ['10.0.0.5', /private 10\.0\.0\.0\/8/i],
    ['10.255.255.255', /private 10\.0\.0\.0\/8/i],
    ['192.168.1.1', /private 192\.168\.0\.0\/16/i],
    ['172.16.0.1', /private 172\.16\.0\.0\/12/i],
    ['172.31.255.255', /private 172\.16\.0\.0\/12/i],
    ['127.0.0.1', /loopback 127\.0\.0\.0\/8/i],
    ['169.254.169.254', /link-local 169\.254\.0\.0\/16/i], // cloud metadata endpoint
    ['0.0.0.0', /reserved 0\.0\.0\.0\/8/i],
  ])('rejects private/reserved IPv4 literal %s', async (ip, reasonMatch) => {
    const result = await isSafeWebhookUrl(`https://${ip}/hook`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reasonMatch);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it.each([
    '172.15.255.255', // just below the 172.16.0.0/12 block
    '172.32.0.0', // just above the 172.16.0.0/12 block
    '169.253.255.255', // just below 169.254.0.0/16
    '169.255.0.0', // just above 169.254.0.0/16
    '1.1.1.1',
    '93.184.216.34',
  ])('allows public IPv4 literal %s (including range boundaries)', async (ip) => {
    const result = await isSafeWebhookUrl(`https://${ip}/hook`);
    expect(result.ok).toBe(true);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it.each([
    ['[::1]', /loopback ::1/i],
    ['[fe80::1]', /link-local fe80::\/10/i],
    ['[fe80::abcd]', /link-local fe80::\/10/i],
    ['[fc00::1]', /unique-local fc00::\/7/i],
    ['[fd12:3456:789a::1]', /unique-local fc00::\/7/i],
  ])('rejects unsafe IPv6 literal %s', async (bracketed, reasonMatch) => {
    const result = await isSafeWebhookUrl(`https://${bracketed}/hook`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(reasonMatch);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('allows a public IPv6 literal', async () => {
    const result = await isSafeWebhookUrl('https://[2001:4860:4860::8888]/hook');
    expect(result.ok).toBe(true);
    expect(lookupMock).not.toHaveBeenCalled();
  });
});

describe('isSafeWebhookUrl — DNS-rebind guard (hostnames resolved via dns.promises.lookup)', () => {
  it('rejects a hostname that resolves to a private IPv4 address', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '10.0.0.5', family: 4 }]);

    const result = await isSafeWebhookUrl('https://evil.example.com/hook');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/resolved to private\/loopback address/i);
    expect(lookupMock).toHaveBeenCalledWith('evil.example.com', { all: true });
  });

  it('rejects a hostname that resolves to IPv6 loopback (::1)', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '::1', family: 6 }]);

    const result = await isSafeWebhookUrl('https://rebind.example.com/hook');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/loopback ::1/i);
  });

  it('rejects a hostname that resolves to a unique-local IPv6 address (fd00::/8)', async () => {
    lookupMock.mockResolvedValueOnce([{ address: 'fd00::1', family: 6 }]);

    const result = await isSafeWebhookUrl('https://rebind2.example.com/hook');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/unique-local fc00::\/7/i);
  });

  it('rejects a hostname that resolves to a link-local IPv6 address (fe80::/10)', async () => {
    lookupMock.mockResolvedValueOnce([{ address: 'fe80::1', family: 6 }]);

    const result = await isSafeWebhookUrl('https://rebind3.example.com/hook');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/link-local fe80::\/10/i);
  });

  it('allows a hostname that resolves to a public IPv4 address', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);

    const result = await isSafeWebhookUrl('https://good.example.com/hook');

    expect(result.ok).toBe(true);
  });

  it('rejects when the DNS response is MIXED: a public address plus a private one', async () => {
    // The validator must check EVERY resolved address, not just the first —
    // a hostname that answers with both a public and a private/internal
    // address is exactly the multi-answer rebind trick this guard exists for.
    lookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.1', family: 4 },
    ]);

    const result = await isSafeWebhookUrl('https://mixed.example.com/hook');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/resolved to private\/loopback address/i);
  });

  it('rejects a MIXED response regardless of which position the unsafe address is in', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '10.0.0.1', family: 4 },
      { address: '93.184.216.34', family: 4 },
    ]);

    const result = await isSafeWebhookUrl('https://mixed2.example.com/hook');

    expect(result.ok).toBe(false);
  });

  it('allows a MIXED response when every address is public (v4 + v6)', async () => {
    lookupMock.mockResolvedValueOnce([
      { address: '93.184.216.34', family: 4 },
      { address: '2001:4860:4860::8888', family: 6 },
    ]);

    const result = await isSafeWebhookUrl('https://dual-stack.example.com/hook');

    expect(result.ok).toBe(true);
  });

  it('fails CLOSED (rejects) when the DNS lookup itself throws', async () => {
    lookupMock.mockRejectedValueOnce(new Error('ENOTFOUND'));

    const result = await isSafeWebhookUrl('https://unresolvable.example.com/hook');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/dns lookup failed/i);
  });
});

describe('isSafeWebhookUrl — scheme/host format handling', () => {
  it('rejects http:// (https required) WITHOUT performing a DNS lookup', async () => {
    const result = await isSafeWebhookUrl('http://good.example.com/hook');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/only https:\/\/ urls are allowed/i);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects non-http(s) schemes', async () => {
    const result = await isSafeWebhookUrl('ftp://good.example.com/hook');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/only https:\/\/ urls are allowed/i);
  });

  it('rejects an unparseable URL string', async () => {
    const result = await isSafeWebhookUrl('not a url at all');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/invalid url/i);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects the "localhost" hostname', async () => {
    const result = await isSafeWebhookUrl('https://localhost/hook');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/loopback\/local hosts are not allowed/i);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects a "*.localhost" hostname', async () => {
    const result = await isSafeWebhookUrl('https://foo.localhost/hook');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/loopback\/local hosts are not allowed/i);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('rejects a "*.local" mDNS-style hostname', async () => {
    const result = await isSafeWebhookUrl('https://printer.local/hook');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/loopback\/local hosts are not allowed/i);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('ignores the port on an IPv4 literal (no DNS lookup, still passes)', async () => {
    const result = await isSafeWebhookUrl('https://93.184.216.34:8443/hook');
    expect(result.ok).toBe(true);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('resolves via DNS using the bare hostname (port excluded) when a port is present', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '93.184.216.34', family: 4 }]);

    const result = await isSafeWebhookUrl('https://good.example.com:9000/hook');

    expect(result.ok).toBe(true);
    expect(lookupMock).toHaveBeenCalledWith('good.example.com', { all: true });
  });
});

describe('isSafeWebhookUrl — extended SSRF ranges', () => {
  it.each([
    '100.64.0.1', '100.127.255.255', // CGNAT 100.64.0.0/10
    '198.18.0.1', '198.19.255.255', // benchmarking 198.18.0.0/15
    '192.0.0.1', // 192.0.0.0/24
    '224.0.0.1', '239.255.255.255', // multicast
    '240.0.0.1', '255.255.255.255', // reserved
  ])('rejects IPv4 literal %s', async (ip) => {
    const result = await isSafeWebhookUrl(`https://${ip}/hook`);
    expect(result.ok).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it.each(['100.63.255.255', '100.128.0.1', '198.17.255.255', '198.20.0.1', '192.0.1.1', '223.255.255.255'])(
    'allows public IPv4 literal %s just outside the blocked ranges',
    async (ip) => {
      const result = await isSafeWebhookUrl(`https://${ip}/hook`);
      expect(result.ok).toBe(true);
    },
  );

  it.each([
    '[::]',
    '[::1]',
    '[::ffff:127.0.0.1]',
    '[::ffff:7f00:1]',
    '[::ffff:10.0.0.1]',
    '[::ffff:a9fe:a9fe]', // 169.254.169.254 in hex form
    '[::ffff:c0a8:101]', // 192.168.1.1
    '[::127.0.0.1]', // IPv4-compatible
    '[fe80::1]',
    '[febf::1]', // still inside fe80::/10
    '[fc00::1]',
    '[fdff::1]',
    '[ff02::1]', // multicast
    '[64:ff9b::7f00:1]', // NAT64 -> 127.0.0.1
    '[64:ff9b::10.0.0.1]', // NAT64 -> 10.0.0.1
    '[64:ff9b::808:808]', // NAT64 -> public 8.8.8.8 is still refused
    '[2002:7f00:1::]', // 6to4 -> 127.0.0.1
    '[2002:a9fe:a9fe::1]', // 6to4 -> 169.254.169.254
    '[2002:808:808::]', // 6to4 -> public 8.8.8.8 is still refused
    '[fec0::1]', // site-local
    '[febf::1]',
    '[2001:0:4136:e378:8000:63bf:3fff:fdd2]', // Teredo
  ])('rejects IPv6 literal %s', async (host) => {
    const result = await isSafeWebhookUrl(`https://${host}/hook`);
    expect(result.ok).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it.each(['[::ffff:5db8:d822]', '[2001:4860:4860::8888]', '[2001:db8::1]', '[::ffff:8.8.8.8]'])(
    'allows public IPv6 / mapped public literal %s',
    async (host) => {
      const result = await isSafeWebhookUrl(`https://${host}/hook`);
      expect(result.ok).toBe(true);
    },
  );

  it('names the embedded private IPv4 in the reason for NAT64/6to4 literals', async () => {
    const nat64 = await isSafeWebhookUrl('https://[64:ff9b::a00:1]/hook');
    expect(nat64).toEqual({ ok: false, reason: expect.stringContaining('NAT64') });
    expect(nat64.ok === false && nat64.reason).toContain('10.0.0.0/8');
    const sixToFour = await isSafeWebhookUrl('https://[2002:c0a8:101::]/hook');
    expect(sixToFour.ok === false && sixToFour.reason).toContain('192.168.0.0/16');
  });

  it('rejects a hostname resolving to a NAT64 address', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '64:ff9b::7f00:1', family: 6 }]);
    const result = await isSafeWebhookUrl('https://nat64.example.com/hook');
    expect(result.ok).toBe(false);
  });

  it('rejects a hostname resolving to an IPv4-mapped loopback address', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '::ffff:127.0.0.1', family: 6 }]);
    const result = await isSafeWebhookUrl('https://mapped.example.com/hook');
    expect(result.ok).toBe(false);
  });

  it('rejects a hostname resolving to CGNAT space', async () => {
    lookupMock.mockResolvedValueOnce([{ address: '100.64.1.1', family: 4 }]);
    const result = await isSafeWebhookUrl('https://cgnat.example.com/hook');
    expect(result.ok).toBe(false);
  });

  it('rejects "localhost." with a trailing dot', async () => {
    const result = await isSafeWebhookUrl('https://localhost./hook');
    expect(result.ok).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('normalises obfuscated IPv4 forms (decimal/hex) before checking', async () => {
    expect((await isSafeWebhookUrl('https://2130706433/hook')).ok).toBe(false); // 127.0.0.1
    expect((await isSafeWebhookUrl('https://0x7f.1/hook')).ok).toBe(false);
  });
});

describe('validateWebhookEvents', () => {
  it('accepts known events and removes duplicates', () => {
    expect(validateWebhookEvents(['ticket.created', 'ticket.created', 'contact.updated']))
      .toEqual({ ok: true, events: ['ticket.created', 'contact.updated'] });
  });

  it.each([undefined, null, 'ticket.created', [], {}])('rejects non-array/empty input %j', (input) => {
    expect(validateWebhookEvents(input).ok).toBe(false);
  });

  it('rejects unknown and non-string entries', () => {
    const result = validateWebhookEvents(['ticket.created', 'nope', 5]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/nope, 5/);
  });
});
