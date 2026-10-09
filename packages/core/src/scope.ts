import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AppError } from './errors.js';

/**
 * Guard scope tunggal untuk semua modul (taskbook §5.1, §7.1, T-040).
 *
 * Prinsip:
 * - Scope minimum adalah origin yang disetujui. Host/subdomain lain tidak ikut.
 * - Mode `remote` tidak mengizinkan alamat loopback/private/link-local/metadata/reserved.
 * - Mode `local-fixture` hanya mengizinkan loopback (localhost, 127.0.0.1, ::1).
 * - Setiap hop redirect diperiksa ulang dengan fungsi yang sama.
 * - Alasan penolakan dikembalikan sebagai kode aman; detail jaringan internal tidak dibocorkan.
 */

export const SCOPE_MODES = ['remote', 'local-fixture'] as const;
export type ScopeMode = (typeof SCOPE_MODES)[number];

/** Port yang diizinkan untuk target remote. Port lain ditolak (taskbook T-040 negative tests). */
export const REMOTE_ALLOWED_PORTS: readonly number[] = Object.freeze([80, 443]);

/** Batas jumlah hop redirect yang diikuti. */
export const MAX_REDIRECT_HOPS = 5;

/** Batas panjang URL mentah yang diterima. */
export const MAX_URL_LENGTH = 2048;

export type AddressClass =
  'public' | 'loopback' | 'private' | 'link-local' | 'metadata' | 'reserved';

/** Kode alasan penolakan. Hanya kode ini (dan pesan aman) yang boleh tampil ke pengguna. */
export const SCOPE_DENY_REASONS = [
  'url-invalid',
  'url-too-long',
  'url-control-characters',
  'protocol-not-allowed',
  'credentials-not-allowed',
  'port-not-allowed',
  'hostname-invalid',
  'hostname-not-allowed',
  'origin-not-in-scope',
  'address-not-allowed',
  'dns-resolution-failed',
  'dns-resolution-empty',
  'fixture-host-only',
  'redirect-limit-exceeded',
  'redirect-missing-location',
] as const;
export type ScopeDenyReason = (typeof SCOPE_DENY_REASONS)[number];

export type ScopeGrant = {
  /** Origin kanonis yang disetujui, misalnya `https://example.com` atau `http://127.0.0.1:4178`. */
  readonly origin: string;
  readonly mode: ScopeMode;
};

export type ScopeDecision =
  | { allowed: true; origin: string; hostname: string; addresses: readonly string[] }
  | { allowed: false; reason: ScopeDenyReason };

/** Resolver DNS yang dapat diinjeksi (tes memakai mock). Mengembalikan alamat IP string. */
export type Resolver = (hostname: string) => Promise<readonly string[]>;

export const defaultResolver: Resolver = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

// ---------- Klasifikasi alamat IP ----------

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    nums.push(n);
  }
  return nums;
}

/** Klasifikasi IPv4 literal. */
export function classifyIPv4(ip: string): AddressClass {
  const o = parseIPv4(ip);
  if (!o) return 'reserved';
  const [a = 0, b = 0, c = 0, d = 0] = o;
  // Metadata cloud yang dikenal.
  if (a === 169 && b === 254 && c === 169 && d === 254) return 'metadata';
  if (a === 100 && b === 100 && c === 100 && d === 200) return 'metadata';
  if (a === 0) return 'reserved';
  if (a === 10) return 'private';
  if (a === 127) return 'loopback';
  if (a === 169 && b === 254) return 'link-local';
  if (a === 172 && b >= 16 && b <= 31) return 'private';
  if (a === 192 && b === 168) return 'private';
  if (a === 100 && b >= 64 && b <= 127) return 'private'; // CGNAT
  if (a === 192 && b === 0 && c === 0) return 'reserved';
  if (a === 192 && b === 0 && c === 2) return 'reserved'; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return 'reserved';
  if (a === 198 && b === 51 && c === 100) return 'reserved';
  if (a === 203 && b === 0 && c === 113) return 'reserved';
  if (a >= 224) return 'reserved'; // multicast, reserved, broadcast
  return 'public';
}

/** Memperluas IPv6 (termasuk `::` dan tail IPv4) menjadi 8 hextet. Null bila tidak valid. */
function expandIPv6(ip: string): number[] | null {
  let s = ip.toLowerCase();
  const zone = s.indexOf('%');
  if (zone !== -1) s = s.slice(0, zone);
  // Tail IPv4 (misalnya ::ffff:192.168.0.1).
  const lastColon = s.lastIndexOf(':');
  const tail = s.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    const [a = 0, b = 0, c = 0, d = 0] = v4;
    s = `${s.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = (halves[0] ?? '') === '' ? [] : (halves[0] ?? '').split(':');
  const rest =
    halves.length === 2 ? ((halves[1] ?? '') === '' ? [] : (halves[1] ?? '').split(':')) : [];
  const fill = 8 - head.length - rest.length;
  if (halves.length === 2 ? fill < 1 : head.length !== 8) return null;
  const all = halves.length === 2 ? [...head, ...Array<string>(fill).fill('0'), ...rest] : head;
  const out: number[] = [];
  for (const h of all) {
    if (!/^[0-9a-f]{1,4}$/.test(h)) return null;
    out.push(Number.parseInt(h, 16));
  }
  return out.length === 8 ? out : null;
}

function v4FromHextets(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`;
}

/** Klasifikasi IPv6 literal. Hanya 2000::/3 (global unicast) yang dianggap publik. */
export function classifyIPv6(ip: string): AddressClass {
  const h = expandIPv6(ip);
  if (!h) return 'reserved';
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0, h6 = 0, h7 = 0] = h;
  // AWS IPv6 metadata.
  if (h0 === 0xfd00 && h1 === 0x0ec2 && h7 === 0x0254) return 'metadata';
  // IPv4-mapped ::ffff:0:0/96 dan IPv4-compatible (deprecated) ::/96 → klasifikasi IPv4 tertanam.
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0xffff) {
    return classifyIPv4(v4FromHextets(h6, h7));
  }
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    if (h6 === 0 && h7 === 0) return 'reserved'; // ::
    if (h6 === 0 && h7 === 1) return 'loopback'; // ::1
    return 'reserved'; // ::/96 deprecated IPv4-compatible
  }
  // NAT64 well-known prefix 64:ff9b::/96 → IPv4 tertanam.
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return classifyIPv4(v4FromHextets(h6, h7));
  }
  // 6to4 2002::/16 → IPv4 tertanam di hextet 1-2.
  if (h0 === 0x2002) {
    return classifyIPv4(v4FromHextets(h1, h2));
  }
  if ((h0 & 0xfe00) === 0xfc00) return 'private'; // fc00::/7 unique local
  if ((h0 & 0xffc0) === 0xfe80) return 'link-local'; // fe80::/10
  // Rentang dokumentasi dan protokol khusus di dalam 2000::/3 bukan alamat publik.
  if (h0 === 0x2001 && h1 === 0x0db8) return 'reserved'; // 2001:db8::/32 dokumentasi
  if (h0 === 0x2001 && h1 < 0x0200) return 'reserved'; // 2001::/23 IETF protocol assignments
  if (h0 === 0x3fff && h1 < 0x1000) return 'reserved'; // 3fff::/20 dokumentasi
  if ((h0 & 0xe000) === 0x2000) return 'public'; // 2000::/3 global unicast
  return 'reserved'; // multicast, discard, documentation, dan lainnya
}

/** Klasifikasi alamat IP apa pun. Bukan IP valid dianggap `reserved` (fail closed). */
export function classifyAddress(ip: string): AddressClass {
  const v = isIP(ip);
  if (v === 4) return classifyIPv4(ip);
  if (v === 6) return classifyIPv6(ip);
  return 'reserved';
}

// ---------- Validasi URL dan hostname ----------

const BLOCKED_HOST_SUFFIXES = [
  '.localhost',
  '.local',
  '.localdomain',
  '.internal',
  '.home.arpa',
  '.lan',
  '.intranet',
];

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Validasi bentuk hostname (sudah dinormalisasi oleh WHATWG URL). Menolak trailing dot,
 * karakter aneh, label kosong, dan hostname tanpa titik (nama intranet pendek).
 */
function hostnameShapeOk(hostname: string): boolean {
  if (hostname.length === 0 || hostname.length > 253) return false;
  if (hostname === 'localhost') return true; // diizinkan bentuknya; kebijakan mode menentukan
  if (hostname.startsWith('[')) return true; // IPv6 literal, diklasifikasi terpisah
  if (hostname.endsWith('.')) return false;
  if (isIP(hostname) === 4) return true;
  const labels = hostname.split('.');
  if (labels.length < 2) return false;
  return labels.every((label) => HOST_LABEL.test(label));
}

export type CanonicalUrl = {
  readonly href: string;
  readonly origin: string;
  readonly protocol: 'http:' | 'https:';
  readonly hostname: string;
  readonly port: number;
};

/**
 * Parsing URL kanonis. Menolak skema selain HTTP(S), credentials, port tidak diizinkan,
 * karakter kontrol/whitespace, dan hostname yang tidak valid. WHATWG URL menormalisasi
 * bentuk IP tersamar (decimal/hex/octal) menjadi IPv4 dotted, sehingga pemeriksaan
 * dilakukan pada hasil normalisasi.
 */
export function canonicalizeUrl(
  input: string,
  options: { allowAnyPort?: boolean } = {},
): { ok: true; url: CanonicalUrl } | { ok: false; reason: ScopeDenyReason } {
  if (typeof input !== 'string') return { ok: false, reason: 'url-invalid' };
  if (input.length > MAX_URL_LENGTH) return { ok: false, reason: 'url-too-long' };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0020\u007f]/.test(input)) return { ok: false, reason: 'url-control-characters' };
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return { ok: false, reason: 'url-invalid' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: 'protocol-not-allowed' };
  }
  if (u.username !== '' || u.password !== '')
    return { ok: false, reason: 'credentials-not-allowed' };
  const port = u.port === '' ? (u.protocol === 'https:' ? 443 : 80) : Number(u.port);
  if (!options.allowAnyPort && !REMOTE_ALLOWED_PORTS.includes(port)) {
    return { ok: false, reason: 'port-not-allowed' };
  }
  if (options.allowAnyPort && (port < 1024 || port > 65535)) {
    return { ok: false, reason: 'port-not-allowed' };
  }
  const hostname = u.hostname;
  if (!hostnameShapeOk(hostname)) return { ok: false, reason: 'hostname-invalid' };
  return {
    ok: true,
    url: {
      href: u.href,
      origin: u.origin,
      protocol: u.protocol,
      hostname,
      port,
    },
  };
}

/** Origin kanonis untuk input target. Dipakai saat menyimpan target dan membuat grant. */
export function canonicalOriginOf(
  input: string,
  options: { allowAnyPort?: boolean } = {},
): string | null {
  const r = canonicalizeUrl(input, options);
  return r.ok ? r.url.origin : null;
}

function isBlockedRemoteHostname(hostname: string): boolean {
  if (hostname === 'localhost') return true;
  if (hostname === 'metadata.google.internal') return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
}

function isLoopbackLiteralOrLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function addressesAllowed(addresses: readonly string[], mode: ScopeMode): boolean {
  if (addresses.length === 0) return false;
  return addresses.every((addr) => {
    const cls = classifyAddress(addr);
    return mode === 'remote' ? cls === 'public' : cls === 'loopback';
  });
}

/**
 * Memutuskan apakah satu URL boleh diakses dalam grant tertentu. Dipanggil untuk setiap
 * navigasi, redirect hop, dan request resource (lihat `createRequestPolicy`).
 */
export async function checkUrlInScope(
  input: string,
  grant: ScopeGrant,
  resolver: Resolver = defaultResolver,
): Promise<ScopeDecision> {
  const canonical = canonicalizeUrl(input, { allowAnyPort: grant.mode === 'local-fixture' });
  if (!canonical.ok) return { allowed: false, reason: canonical.reason };
  const { url } = canonical;

  if (url.origin !== grant.origin) return { allowed: false, reason: 'origin-not-in-scope' };

  if (grant.mode === 'local-fixture') {
    if (!isLoopbackLiteralOrLocalhost(url.hostname)) {
      return { allowed: false, reason: 'fixture-host-only' };
    }
    if (url.hostname === '127.0.0.1' || url.hostname === '[::1]') {
      const addr = url.hostname === '[::1]' ? '::1' : url.hostname;
      return { allowed: true, origin: url.origin, hostname: url.hostname, addresses: [addr] };
    }
    // `localhost` harus tetap resolve hanya ke loopback.
    return resolveAndCheck(url, grant.mode, resolver);
  }

  // Mode remote.
  if (url.hostname.startsWith('[')) {
    const addr = url.hostname.slice(1, -1);
    if (classifyAddress(addr) !== 'public')
      return { allowed: false, reason: 'address-not-allowed' };
    return { allowed: true, origin: url.origin, hostname: url.hostname, addresses: [addr] };
  }
  if (isIP(url.hostname) === 4) {
    if (classifyIPv4(url.hostname) !== 'public') {
      return { allowed: false, reason: 'address-not-allowed' };
    }
    return { allowed: true, origin: url.origin, hostname: url.hostname, addresses: [url.hostname] };
  }
  if (isBlockedRemoteHostname(url.hostname)) {
    return { allowed: false, reason: 'hostname-not-allowed' };
  }
  return resolveAndCheck(url, grant.mode, resolver);
}

async function resolveAndCheck(
  url: CanonicalUrl,
  mode: ScopeMode,
  resolver: Resolver,
): Promise<ScopeDecision> {
  let addresses: readonly string[];
  try {
    addresses = await resolver(url.hostname);
  } catch {
    return { allowed: false, reason: 'dns-resolution-failed' };
  }
  if (addresses.length === 0) return { allowed: false, reason: 'dns-resolution-empty' };
  if (!addressesAllowed(addresses, mode)) return { allowed: false, reason: 'address-not-allowed' };
  return {
    allowed: true,
    origin: url.origin,
    hostname: url.hostname,
    addresses: [...addresses],
  };
}

/**
 * Mengikuti redirect secara manual. Setiap hop diperiksa ulang; redirect keluar origin
 * ditolak. `fetchFn` harus memakai `redirect: 'manual'`. Mengembalikan URL akhir bila lolos.
 */
export async function followRedirectsSafely(
  startUrl: string,
  grant: ScopeGrant,
  fetchFn: (url: string) => Promise<{ status: number; location: string | null }>,
  resolver: Resolver = defaultResolver,
): Promise<{ ok: true; finalUrl: string; hops: number } | { ok: false; reason: ScopeDenyReason }> {
  let current = startUrl;
  for (let hops = 0; ; hops++) {
    const decision = await checkUrlInScope(current, grant, resolver);
    if (!decision.allowed) return { ok: false, reason: decision.reason };
    const res = await fetchFn(current);
    if (res.status < 300 || res.status > 399) {
      return { ok: true, finalUrl: current, hops };
    }
    if (hops >= MAX_REDIRECT_HOPS) return { ok: false, reason: 'redirect-limit-exceeded' };
    if (res.location === null || res.location === '') {
      return { ok: false, reason: 'redirect-missing-location' };
    }
    try {
      current = new URL(res.location, current).href;
    } catch {
      return { ok: false, reason: 'url-invalid' };
    }
  }
}

/** Pesan aman untuk penolakan scope. Tidak menyebut alamat internal atau hasil DNS. */
export function scopeDenyMessage(reason: ScopeDenyReason): string {
  switch (reason) {
    case 'origin-not-in-scope':
    case 'redirect-limit-exceeded':
    case 'redirect-missing-location':
      return 'Permintaan berada di luar cakupan yang disetujui.';
    case 'fixture-host-only':
      return 'Mode fixture lokal hanya mengizinkan localhost.';
    default:
      return 'Target ditolak oleh kebijakan cakupan.';
  }
}

/** Grant untuk target dengan mode tertentu. */
export function createScopeGrant(origin: string, mode: ScopeMode): ScopeGrant {
  const canonical = canonicalizeUrl(origin, { allowAnyPort: mode === 'local-fixture' });
  if (!canonical.ok || canonical.url.origin !== origin) {
    throw new AppError('SCOPE_DENIED', {
      debugDetail: `invalid-origin:${canonical.ok ? 'noncanonical' : canonical.reason}`,
    });
  }
  if (mode === 'remote' && isBlockedRemoteHostname(canonical.url.hostname)) {
    throw new AppError('SCOPE_DENIED', { debugDetail: 'remote-hostname-blocked' });
  }
  return { origin: canonical.url.origin, mode };
}

/**
 * Hash SHA-256 atas grant (origin + mode). Dipakai sebagai `scopeHash` pada Authorization
 * Run agar persetujuan dapat ditelusuri tanpa menyimpan dokumen sensitif.
 */
export function scopeHashOf(grant: ScopeGrant): string {
  return createHash('sha256')
    .update(JSON.stringify({ origin: grant.origin, mode: grant.mode }))
    .digest('hex');
}

/** Ringkasan scope yang ditampilkan kepada pengguna sebelum run (tidak memuat detail jaringan). */
export function scopeSummaryOf(grant: ScopeGrant): string {
  const label = grant.mode === 'remote' ? 'Target remote' : 'Fixture lokal';
  return `${label}: ${grant.origin} (hanya origin ini; host lain tidak termasuk)`;
}
