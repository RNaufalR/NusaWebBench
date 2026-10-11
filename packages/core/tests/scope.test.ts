import { describe, expect, it } from 'vitest';
import {
  canonicalOriginOf,
  canonicalizeUrl,
  checkUrlInScope,
  classifyAddress,
  classifyIPv4,
  classifyIPv6,
  createScopeGrant,
  followRedirectsSafely,
  scopeHashOf,
  type Resolver,
  type ScopeGrant,
} from '../src/index.js';

// Resolver mock: tidak ada jaringan nyata. Setiap hostname memetakan ke daftar alamat.
const mockResolver =
  (table: Record<string, string[]>): Resolver =>
  async (hostname) => {
    const found = table[hostname];
    if (!found) throw new Error('ENOTFOUND');
    return found;
  };
const noDns = mockResolver({});

const remote: ScopeGrant = { origin: 'https://example.com', mode: 'remote' };
const publicDns = mockResolver({ 'example.com': ['93.184.216.34'] });

describe('canonicalizeUrl — normalisasi dan penolakan skema', () => {
  it('menerima HTTP(S) dan menormalisasi host/port default', () => {
    const r = canonicalizeUrl('HTTPS://Example.COM:443/path?q=1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.url.origin).toBe('https://example.com');
      expect(r.url.port).toBe(443);
    }
  });

  it.each([
    ['file:///etc/passwd', 'protocol-not-allowed'],
    ['ftp://example.com/', 'protocol-not-allowed'],
    ['data:text/html,hi', 'protocol-not-allowed'],
    ['javascript:alert(1)', 'protocol-not-allowed'],
    ['https://user:pass@example.com/', 'credentials-not-allowed'],
    ['https://user@example.com/', 'credentials-not-allowed'],
    ['https://example.com:8443/', 'port-not-allowed'],
    ['http://example.com:22/', 'port-not-allowed'],
    ['https://example.com/\n', 'url-control-characters'],
    ['https://exa mple.com/', 'url-control-characters'],
    ['not a url', 'url-control-characters'],
    ['https://', 'url-invalid'],
    ['https://example.com.:443/', 'hostname-invalid'],
    ['https://intranet/', 'hostname-invalid'],
    ['https://localhost./', 'hostname-invalid'],
    ['https://ex_ample.com/', 'hostname-invalid'],
  ])('menolak %s (%s)', (input, reason) => {
    const r = canonicalizeUrl(input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(reason);
  });

  it('menolak URL yang terlalu panjang', () => {
    const r = canonicalizeUrl(`https://example.com/${'a'.repeat(2100)}`);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('url-too-long');
  });

  it('origin spoofing dengan suffix tidak lolos sebagai origin yang sama', () => {
    expect(canonicalOriginOf('https://example.com.evil.net/')).toBe('https://example.com.evil.net');
    expect(canonicalOriginOf('https://example.com.evil.net/')).not.toBe('https://example.com');
  });
});

describe('klasifikasi alamat IP', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.0.9', 'loopback'],
    ['10.0.0.1', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['172.32.0.1', 'public'],
    ['192.168.1.1', 'private'],
    ['100.64.0.1', 'private'],
    ['169.254.1.1', 'link-local'],
    ['169.254.169.254', 'metadata'],
    ['100.100.100.200', 'metadata'],
    ['0.0.0.0', 'reserved'],
    ['224.0.0.1', 'reserved'],
    ['255.255.255.255', 'reserved'],
    ['198.18.0.1', 'reserved'],
    ['93.184.216.34', 'public'],
    ['999.1.1.1', 'reserved'],
  ] as const)('IPv4 %s → %s', (ip, cls) => {
    expect(classifyIPv4(ip)).toBe(cls);
  });

  it.each([
    ['::1', 'loopback'],
    ['::', 'reserved'],
    ['fc00::1', 'private'],
    ['fd12:3456::1', 'private'],
    ['fe80::1', 'link-local'],
    ['fd00:ec2::254', 'metadata'],
    ['ff02::1', 'reserved'],
    ['::ffff:127.0.0.1', 'loopback'],
    ['::ffff:10.1.2.3', 'private'],
    ['::ffff:169.254.169.254', 'metadata'],
    ['64:ff9b::7f00:1', 'loopback'],
    ['2002:7f00:0001::1', 'loopback'],
    ['2001:4860:4860::8888', 'public'],
    ['2001:db8::1', 'reserved'],
    ['not-an-ip', 'reserved'],
    ['2001::zz', 'reserved'],
  ] as const)('IPv6 %s → %s', (ip, cls) => {
    expect(classifyIPv6(ip)).toBe(cls);
  });

  it('bukan IP valid selalu reserved (fail closed)', () => {
    expect(classifyAddress('')).toBe('reserved');
    expect(classifyAddress('example.com')).toBe('reserved');
  });
});

describe('checkUrlInScope — mode remote', () => {
  it('mengizinkan origin yang disetujui dengan DNS publik', async () => {
    const d = await checkUrlInScope('https://example.com/a', remote, publicDns);
    expect(d.allowed).toBe(true);
    if (d.allowed) expect(d.addresses).toEqual(['93.184.216.34']);
  });

  it('menolak subdomain dan host lain (scope minimum = origin)', async () => {
    for (const url of [
      'https://www.example.com/',
      'https://api.example.com/',
      'http://example.com/',
    ]) {
      const d = await checkUrlInScope(url, remote, publicDns);
      expect(d).toEqual({ allowed: false, reason: 'origin-not-in-scope' });
    }
  });

  it.each([
    'http://localhost/',
    'http://LOCALHOST./',
    'http://127.0.0.1/',
    'http://127.1/',
    'http://0x7f.0.0.1/',
    'http://2130706433/',
    'http://0177.0.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://10.0.0.5/',
    'http://192.168.0.10/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[fd00:ec2::254]/',
    'http://metadata.google.internal/',
    'http://printer.local/',
    'http://service.internal/',
  ])('menolak alamat berbahaya %s', async (url) => {
    const grant: ScopeGrant = { origin: canonicalOriginOf(url) ?? 'http://x.test', mode: 'remote' };
    const d = await checkUrlInScope(url, grant, noDns);
    expect(d.allowed).toBe(false);
  });

  it('menolak IP literal privat walaupun grant origin-nya sama', async () => {
    const grant: ScopeGrant = { origin: 'http://10.0.0.5', mode: 'remote' };
    const d = await checkUrlInScope('http://10.0.0.5/', grant, noDns);
    expect(d).toEqual({ allowed: false, reason: 'address-not-allowed' });
  });

  it('DNS rebinding: hostname publik yang resolve ke IP privat ditolak', async () => {
    const rebind = mockResolver({ 'example.com': ['93.184.216.34', '10.0.0.7'] });
    const d = await checkUrlInScope('https://example.com/', remote, rebind);
    expect(d).toEqual({ allowed: false, reason: 'address-not-allowed' });
  });

  it('DNS resolve ke loopback ditolak', async () => {
    const d = await checkUrlInScope(
      'https://example.com/',
      remote,
      mockResolver({ 'example.com': ['127.0.0.1'] }),
    );
    expect(d.allowed).toBe(false);
  });

  it('DNS gagal atau kosong ditolak tanpa membocorkan detail', async () => {
    const failing = await checkUrlInScope('https://example.com/', remote, mockResolver({}));
    expect(failing).toEqual({ allowed: false, reason: 'dns-resolution-failed' });
    const empty = await checkUrlInScope(
      'https://example.com/',
      remote,
      mockResolver({ 'example.com': [] }),
    );
    expect(empty).toEqual({ allowed: false, reason: 'dns-resolution-empty' });
  });

  it('encoded hostname tricks (percent-encoding) tidak melemahkan scope', async () => {
    const d = await checkUrlInScope('https://exa%6dple.com/', remote, publicDns);
    // WHATWG mendekode host persen; hasilnya tetap example.com dan harus lolos scope yang sama.
    expect(d.allowed).toBe(true);
  });

  it('port yang tidak diizinkan ditolak pada remote', async () => {
    const d = await checkUrlInScope('https://example.com:8080/', remote, publicDns);
    expect(d).toEqual({ allowed: false, reason: 'port-not-allowed' });
  });
});

describe('checkUrlInScope — mode local-fixture', () => {
  const fixture: ScopeGrant = { origin: 'http://127.0.0.1:4178', mode: 'local-fixture' };

  it('mengizinkan loopback yang disetujui', async () => {
    const d = await checkUrlInScope('http://127.0.0.1:4178/index.html', fixture, noDns);
    expect(d.allowed).toBe(true);
  });

  it('menolak localhost bila grant adalah origin 127.0.0.1 (origin berbeda)', async () => {
    const d = await checkUrlInScope('http://localhost:4178/', fixture, noDns);
    expect(d).toEqual({ allowed: false, reason: 'origin-not-in-scope' });
  });

  it('menolak jaringan privat walau port cocok', async () => {
    const grant: ScopeGrant = { origin: 'http://192.168.1.5:4178', mode: 'local-fixture' };
    const d = await checkUrlInScope('http://192.168.1.5:4178/', grant, noDns);
    expect(d.allowed).toBe(false);
  });

  it('localhost yang resolve ke non-loopback ditolak', async () => {
    const grant: ScopeGrant = { origin: 'http://localhost:4178', mode: 'local-fixture' };
    const d = await checkUrlInScope(
      'http://localhost:4178/',
      grant,
      mockResolver({ localhost: ['10.9.9.9'] }),
    );
    expect(d.allowed).toBe(false);
  });

  it('hostname publik tidak diizinkan dalam mode fixture', async () => {
    const grant: ScopeGrant = { origin: 'http://example.com:8080', mode: 'local-fixture' };
    const d = await checkUrlInScope('http://example.com:8080/', grant, publicDns);
    expect(d).toEqual({ allowed: false, reason: 'fixture-host-only' });
  });
});

describe('redirect', () => {
  const hop =
    (table: Record<string, { status: number; location: string | null }>) => async (url: string) =>
      table[url] ?? { status: 200, location: null };

  it('redirect dalam origin yang sama diikuti', async () => {
    const r = await followRedirectsSafely(
      'https://example.com/a',
      remote,
      hop({ 'https://example.com/a': { status: 301, location: '/b' } }),
      publicDns,
    );
    expect(r).toEqual({ ok: true, finalUrl: 'https://example.com/b', hops: 1 });
  });

  it('redirect keluar origin ditolak', async () => {
    const r = await followRedirectsSafely(
      'https://example.com/a',
      remote,
      hop({ 'https://example.com/a': { status: 302, location: 'https://evil.test/' } }),
      publicDns,
    );
    expect(r).toEqual({ ok: false, reason: 'origin-not-in-scope' });
  });

  it('redirect ke metadata IP ditolak sebelum request dikirim', async () => {
    const seen: string[] = [];
    const r = await followRedirectsSafely(
      'https://example.com/a',
      remote,
      async (url) => {
        seen.push(url);
        return { status: 302, location: 'http://169.254.169.254/latest/' };
      },
      publicDns,
    );
    expect(r.ok).toBe(false);
    expect(seen).toEqual(['https://example.com/a']);
  });

  it('redirect loop dibatasi jumlah hop', async () => {
    const r = await followRedirectsSafely(
      'https://example.com/a',
      remote,
      async () => ({ status: 302, location: '/a' }),
      publicDns,
    );
    expect(r).toEqual({ ok: false, reason: 'redirect-limit-exceeded' });
  });

  it('redirect tanpa Location ditolak', async () => {
    const r = await followRedirectsSafely(
      'https://example.com/a',
      remote,
      async () => ({ status: 302, location: null }),
      publicDns,
    );
    expect(r).toEqual({ ok: false, reason: 'redirect-missing-location' });
  });

  it('Location dengan skema file: ditolak', async () => {
    const r = await followRedirectsSafely(
      'https://example.com/a',
      remote,
      async () => ({ status: 302, location: 'file:///etc/passwd' }),
      publicDns,
    );
    expect(r.ok).toBe(false);
  });
});

describe('grant dan hash', () => {
  it('createScopeGrant menerima origin kanonis saja', () => {
    expect(createScopeGrant('https://example.com', 'remote')).toEqual({
      origin: 'https://example.com',
      mode: 'remote',
    });
    expect(() => createScopeGrant('https://example.com/path', 'remote')).toThrow();
    expect(() => createScopeGrant('https://localhost', 'remote')).toThrow();
  });

  it('hash scope deterministik dan berbeda untuk mode berbeda', () => {
    const a = scopeHashOf({ origin: 'http://127.0.0.1:4178', mode: 'local-fixture' });
    const b = scopeHashOf({ origin: 'http://127.0.0.1:4178', mode: 'local-fixture' });
    const c = scopeHashOf({ origin: 'http://127.0.0.1:4178', mode: 'remote' });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });
});
