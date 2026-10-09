/**
 * Koneksi yang dipin ke alamat yang sudah diperiksa scope (F-05, F-06).
 *
 * Masalah yang diperbaiki: `checkUrlInScope` me-resolve DNS saat cek, lalu klien lain (Playwright
 * `request`, atau resolver Chrome) me-resolve ulang saat koneksi. Di antara keduanya, DNS bisa
 * berubah (DNS rebinding). Di sini koneksi memakai `lookup` yang hanya mengembalikan alamat hasil
 * cek, sehingga resolusi kedua tidak terjadi.
 */
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { AppError } from './errors.js';
import {
  MAX_REDIRECT_HOPS,
  checkUrlInScope,
  defaultResolver,
  type Resolver,
  type ScopeDenyReason,
  type ScopeGrant,
} from './scope.js';

export type PinnedFetchResult =
  | { ok: true; finalUrl: string; hops: number; status: number }
  | { ok: false; reason: ScopeDenyReason | 'fetch-failed' };

/**
 * Lookup yang selalu mengembalikan `address` yang sudah diperiksa. Tidak pernah memanggil DNS.
 * Mendukung kedua bentuk callback Node (`all: true` dan alamat tunggal).
 */
export function pinnedLookup(
  address: string,
): (
  hostname: string,
  options: unknown,
  callback: (err: Error | null, address: unknown, family?: number) => void,
) => void {
  const family = isIP(address);
  return (_hostname, options, callback) => {
    const wantsAll =
      typeof options === 'object' && options !== null && 'all' in options && options.all === true;
    if (wantsAll) callback(null, [{ address, family }]);
    else callback(null, address, family);
  };
}

/**
 * GET satu hop tanpa mengikuti redirect dan tanpa membaca body. Koneksi ke `address` (yang sudah
 * diperiksa). Mengembalikan status dan header `location` mentah.
 *
 * - `agent: false`: socket tidak disimpan di pool keep-alive dan ditutup setelah respons.
 * - `timeoutMs` adalah batas idle socket. `signal` membatalkan request dan menutup socket.
 * - Body respons tidak dibaca (dibuang), sehingga ukuran body tidak memengaruhi memori.
 * - SNI dan verifikasi sertifikat HTTPS memakai hostname dari URL (bukan `address`).
 */
export function pinnedGet(
  url: string,
  address: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ status: number; location: string | null }> {
  const target = new URL(url);
  const requester = target.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const req = requester(
      target,
      {
        method: 'GET',
        lookup: pinnedLookup(address) as never,
        headers: { accept: '*/*', 'user-agent': 'NusaWebBench-link-check' },
        timeout: timeoutMs,
        agent: false,
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        const location = typeof res.headers.location === 'string' ? res.headers.location : null;
        res.destroy();
        resolve({ status, location });
      },
    );
    const onAbort = (): void => {
      req.destroy(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) => {
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
    req.on('close', () => signal?.removeEventListener('abort', onAbort));
    req.end();
  });
}

/**
 * Mengikuti redirect dengan koneksi terpin. Setiap hop: cek scope (resolve sekali), lalu koneksi
 * ke alamat hasil cek itu. Mengembalikan status akhir (termasuk 4xx/5xx) bila hop berakhir normal.
 *
 * Batas: `MAX_REDIRECT_HOPS` hop, dan `totalTimeoutMs` untuk seluruh rantai (bukan per hop).
 * `signal` membatalkan rantai yang sedang berjalan; socket aktif ditutup.
 */
export async function followRedirectsPinned(
  startUrl: string,
  grant: ScopeGrant,
  totalTimeoutMs: number,
  resolver: Resolver = defaultResolver,
  signal?: AbortSignal,
): Promise<PinnedFetchResult> {
  const deadline = AbortSignal.timeout(totalTimeoutMs);
  const combined = signal === undefined ? deadline : AbortSignal.any([deadline, signal]);
  let current = startUrl;
  for (let hops = 0; ; hops++) {
    if (combined.aborted) return { ok: false, reason: 'fetch-failed' };
    const decision = await checkUrlInScope(current, grant, resolver);
    if (!decision.allowed) return { ok: false, reason: decision.reason };
    const address = decision.addresses[0];
    if (address === undefined) return { ok: false, reason: 'dns-resolution-empty' };

    let res: { status: number; location: string | null };
    try {
      res = await pinnedGet(current, address, totalTimeoutMs, combined);
    } catch {
      return { ok: false, reason: 'fetch-failed' };
    }
    if (res.status < 300 || res.status > 399) {
      return { ok: true, finalUrl: current, hops, status: res.status };
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

/**
 * Argumen Chrome yang mem-pin host target ke alamat hasil cek scope (mode remote). Host lain
 * dipetakan ke NOTFOUND, sehingga Chrome tidak me-resolve ulang host yang sudah diperiksa dan
 * tidak membuka host lain. Mode local-fixture tidak berubah (`[]`).
 *
 * Literal IP tidak memerlukan resolusi DNS, sehingga tidak ada argumen tambahan untuknya.
 */
export async function browserPinArgs(
  grant: ScopeGrant,
  resolver: Resolver = defaultResolver,
): Promise<string[]> {
  const decision = await checkUrlInScope(`${grant.origin}/`, grant, resolver);
  if (!decision.allowed) {
    throw new AppError('SCOPE_DENIED', { debugDetail: decision.reason });
  }
  if (grant.mode !== 'remote') return [];
  const hostname = new URL(grant.origin).hostname;
  if (hostname.startsWith('[') || isIP(hostname) !== 0) return [];
  const addresses = decision.addresses;
  const chosen = addresses.find((a) => isIP(a) === 4) ?? addresses[0];
  if (chosen === undefined) {
    throw new AppError('SCOPE_DENIED', { debugDetail: 'dns-resolution-empty' });
  }
  const replacement = isIP(chosen) === 6 ? `[${chosen}]` : chosen;
  return [`--host-resolver-rules=MAP ${hostname} ${replacement},MAP * ~NOTFOUND`];
}
