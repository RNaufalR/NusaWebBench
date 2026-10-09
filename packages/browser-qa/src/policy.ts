import { checkUrlInScope, type Resolver, type ScopeGrant } from '@nusawebbench/core';
import type { Request as PwRequest, Route } from 'playwright-core';
import { RISKY_CLICK_PATTERN } from './config.js';

/** Penghitung permintaan yang diblokir oleh kebijakan scope (untuk metrik modul). */
export type RouteStats = { blocked: number };

/**
 * Guard untuk setiap permintaan jaringan browser. Setiap permintaan diperiksa dengan
 * `checkUrlInScope` (origin, protokol, kredensial, dan alamat). Permintaan di luar scope
 * diabaikan dengan `blockedbyclient`. Catatan: permintaan dari `APIRequestContext` tidak
 * melewati route browser, sehingga pemanggil wajib memeriksa scope sendiri (lihat adapter).
 */
export function createRouteGuard(grant: ScopeGrant, stats: RouteStats, resolver?: Resolver) {
  return async (route: Route, request: PwRequest): Promise<void> => {
    const decision = await checkUrlInScope(request.url(), grant, resolver);
    if (decision.allowed) {
      await route.continue();
      return;
    }
    stats.blocked += 1;
    await route.abort('blockedbyclient');
  };
}

/** True bila label tombol mengandung kata aksi berisiko. */
export function isRiskyClickLabel(label: string): boolean {
  return RISKY_CLICK_PATTERN.test(label);
}

/**
 * Mengubah href mentah menjadi URL absolut yang aman untuk di-crawl: hanya http(s),
 * satu origin dengan target, tanpa fragmen, dan tanpa duplikat. Skema lain (mailto:, tel:,
 * javascript:) dibuang.
 */
export function normalizeLinkCandidates(
  hrefs: readonly string[],
  pageUrl: string,
  origin: string,
): string[] {
  const out = new Set<string>();
  for (const href of hrefs) {
    const raw = href.trim();
    if (raw === '' || raw.length > 2048) continue;
    let url: URL;
    try {
      url = new URL(raw, pageUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    if (url.origin !== origin) continue;
    url.hash = '';
    out.add(url.toString());
  }
  return [...out];
}
